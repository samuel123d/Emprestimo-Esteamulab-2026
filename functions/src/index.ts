import {randomBytes, randomInt, randomUUID} from "node:crypto";
import {initializeApp} from "firebase-admin/app";
import {FieldValue, getFirestore, Timestamp} from "firebase-admin/firestore";
import {logger, setGlobalOptions} from "firebase-functions";
import {onDocumentWritten} from "firebase-functions/v2/firestore";
import {HttpsError, onCall} from "firebase-functions/v2/https";
import {onSchedule} from "firebase-functions/v2/scheduler";
import {defineSecret} from "firebase-functions/params";
import nodemailer from "nodemailer";

initializeApp();
setGlobalOptions({maxInstances: 10, region: "us-central1"});

const smtpUser = defineSecret("SMTP_USER");
const smtpAppPassword = defineSecret("SMTP_APP_PASSWORD");
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const staleClaimMilliseconds = 15 * 60 * 1000;
const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * Creates a reservation only when its requested dates do not conflict.
 */
export const createLoanReservation = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Entre para reservar um produto.");
  }

  const itemId = request.data?.itemId;
  const inicio = request.data?.inicio;
  const devolucao = request.data?.devolucao;
  if (
    typeof itemId !== "string" ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(itemId) ||
    !isCalendarDate(inicio) ||
    !isCalendarDate(devolucao)
  ) {
    throw new HttpsError("invalid-argument", "Produto ou datas inválidos.");
  }

  const db = getFirestore();
  const [profileSnapshot, settingsSnapshot] = await Promise.all([
    db.collection("users").doc(request.auth.uid).get(),
    db.collection("settings").doc("app").get(),
  ]);
  const profile = profileSnapshot.data();
  if (!profile || profile.role !== "user") {
    throw new HttpsError(
      "permission-denied",
      "Somente usuários podem criar uma reserva.",
    );
  }

  const maxDays = Number.isInteger(settingsSnapshot.data()?.maxDias) ?
    Math.max(1, Math.min(settingsSnapshot.data()?.maxDias, 365)) :
    30;
  const duration = calendarDayDifference(inicio, devolucao);
  if (
    inicio < dateInSaoPaulo(0) ||
    duration < 1 ||
    duration > maxDays
  ) {
    throw new HttpsError(
      "invalid-argument",
      `A devolução deve ocorrer entre 1 e ${maxDays} dias após o início.`,
    );
  }

  const itemRef = db.collection("items").doc(itemId);
  const availabilityRef = db.collection("itemAvailability").doc(itemId);
  const loanRef = db.collection("loans").doc();
  const code = generateLoanCode();
  const deliveryCode = generateLoanCode(code);
  const loan: Loan & Record<string, string> = {
    itemId,
    userId: request.auth.uid,
    nome: typeof profile.name === "string" ? profile.name : "",
    contato: typeof profile.email === "string" ? profile.email : "",
    inicio,
    devolucao,
    codigo: code,
    codigoEntrega: deliveryCode,
    status: "reservado",
    criado: dateInSaoPaulo(0),
  };
  if (!loan.nome || !loan.contato) {
    throw new HttpsError(
      "failed-precondition",
      "Seu perfil está incompleto. Atualize-o antes de reservar.",
    );
  }

  await db.runTransaction(async (transaction) => {
    const itemSnapshot = await transaction.get(itemRef);
    if (!itemSnapshot.exists) {
      throw new HttpsError("not-found", "Este produto não existe mais.");
    }

    await transaction.get(availabilityRef);
    const existingLoans = await transaction.get(
      db.collection("loans").where("itemId", "==", itemId),
    );
    const periods = existingLoans.docs
      .map((snapshot) => snapshot.data() as Loan)
      .filter((existing) =>
        existing.status === "reservado" || existing.status === "emprestado"
      )
      .map(availabilityPeriod);

    if (periods.some((period) =>
      inicio <= period.devolucao && devolucao >= period.inicio
    )) {
      throw new HttpsError(
        "already-exists",
        "Esse período já foi reservado. Escolha outras datas.",
      );
    }

    transaction.create(loanRef, loan);
    transaction.set(availabilityRef, {
      periods: [...periods, {inicio, devolucao, status: "reservado"}]
        .sort((left, right) => left.inicio.localeCompare(right.inicio)),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  return {id: loanRef.id, ...loan};
});

/**
 * Rebuilds the sanitized public schedule, including loans created before deployment.
 */
export const refreshItemAvailability = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Entre para consultar os produtos.");
  }
  await refreshAvailabilityProjection(getFirestore());
  return {success: true};
});

/**
 * Keeps public availability synchronized without exposing borrower details or codes.
 */
export const syncLoanAvailability = onDocumentWritten(
  "loans/{loanId}",
  async (event) => {
    const previous = event.data?.before.data() as Loan | undefined;
    const current = event.data?.after.data() as Loan | undefined;
    const itemIds = new Set(
      [previous?.itemId, current?.itemId]
        .filter((itemId): itemId is string => Boolean(itemId)),
    );
    const db = getFirestore();
    await Promise.all(
      [...itemIds].map((itemId) => rebuildItemAvailability(db, itemId)),
    );
  },
);

async function refreshAvailabilityProjection(
  db: FirebaseFirestore.Firestore,
): Promise<void> {
  const [loansSnapshot, availabilitySnapshot] = await Promise.all([
    db.collection("loans").get(),
    db.collection("itemAvailability").get(),
  ]);
  const periodsByItem = new Map<string, ReturnType<typeof availabilityPeriod>[]>();
  for (const snapshot of loansSnapshot.docs) {
    const loan = snapshot.data() as Loan;
    if (
      !loan.itemId ||
      (loan.status !== "reservado" && loan.status !== "emprestado")
    ) {
      continue;
    }
    const periods = periodsByItem.get(loan.itemId) || [];
    periods.push(availabilityPeriod(loan));
    periodsByItem.set(loan.itemId, periods);
  }

  const operations = new Map<string, {
    ref: FirebaseFirestore.DocumentReference;
    data?: {periods: ReturnType<typeof availabilityPeriod>[]};
  }>();
  for (const [itemId, periods] of periodsByItem) {
    operations.set(itemId, {
      ref: db.collection("itemAvailability").doc(itemId),
      data: {
        periods: periods.sort((left, right) =>
          left.inicio.localeCompare(right.inicio)
        ),
      },
    });
  }
  for (const snapshot of availabilitySnapshot.docs) {
    if (!periodsByItem.has(snapshot.id)) {
      operations.set(snapshot.id, {ref: snapshot.ref});
    }
  }

  const entries = [...operations.values()];
  for (let offset = 0; offset < entries.length; offset += 450) {
    const batch = db.batch();
    for (const entry of entries.slice(offset, offset + 450)) {
      if (entry.data) {
        batch.set(entry.ref, {
          ...entry.data,
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        batch.delete(entry.ref);
      }
    }
    await batch.commit();
  }
}

async function rebuildItemAvailability(
  db: FirebaseFirestore.Firestore,
  itemId: string,
): Promise<void> {
  const loans = await db.collection("loans")
    .where("itemId", "==", itemId)
    .get();
  const periods = loans.docs
    .map((snapshot) => snapshot.data() as Loan)
    .filter((loan) =>
      loan.status === "reservado" || loan.status === "emprestado"
    )
    .map(availabilityPeriod)
    .sort((left, right) => left.inicio.localeCompare(right.inicio));
  const ref = db.collection("itemAvailability").doc(itemId);
  if (periods.length) {
    await ref.set({periods, updatedAt: FieldValue.serverTimestamp()});
  } else {
    await ref.delete();
  }
}

function availabilityPeriod(loan: Loan): {
  inicio: string;
  devolucao: string;
  status: string;
} {
  const retiradaDate = typeof loan.retirado === "string" ?
    loan.retirado.slice(0, 10) :
    "";
  return {
    inicio: isCalendarDate(loan.inicio) ?
      loan.inicio :
      isCalendarDate(retiradaDate) ?
        retiradaDate :
        isCalendarDate(loan.criado) ? loan.criado : dateInSaoPaulo(0),
    devolucao: isCalendarDate(loan.devolucao) ?
      loan.devolucao :
      dateInSaoPaulo(0),
    status: loan.status || "reservado",
  };
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function calendarDayDifference(start: string, end: string): number {
  return Math.round(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) /
      86400000,
  );
}

function generateLoanCode(excluded = ""): string {
  let code = "";
  do {
    code = Array.from(
      {length: 6},
      () => codeAlphabet[randomInt(codeAlphabet.length)],
    ).join("");
  } while (code === excluded);
  return code;
}

export function generateCode(existing: Set<string>): string {
  let code: string;
  do {
    code = Array.from(randomBytes(6), (b) =>
      codeAlphabet[b % codeAlphabet.length],
    ).join("");
  } while (existing.has(code));
  return code;
}

//empréstimo com verificação de se não tá duplicado e geração segura de códigos

export const createLoan = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Entre para fazer um empréstimo.");
  }

  const {itemId, devolucao} = request.data ?? {};
  if (typeof itemId !== "string" || !itemId || itemId.length > 128) {
    throw new HttpsError("invalid-argument", "Produto inválido.");
  }
  if (
    typeof devolucao !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(devolucao)
  ) {
    throw new HttpsError("invalid-argument", "Data de devolução inválida.");
  }

  const db = getFirestore();
  const uid = request.auth.uid;

  // Valida se o produto existe
  const itemDoc = await db.collection("items").doc(itemId).get();
  if (!itemDoc.exists) {
    throw new HttpsError("not-found", "Produto não encontrado.");
  }

  // Valida se o usuário existe
  const userDoc = await db.collection("users").doc(uid).get();
  if (!userDoc.exists) {
    throw new HttpsError("not-found", "Perfil não encontrado.");
  }
  const userData = userDoc.data()!;

  // Valida o prazo máximo
  const settingsDoc = await db.collection("settings").doc("app").get();
  const maxDias = settingsDoc.data()?.maxDias ?? 30;
  const today = dateInSaoPaulo(0);
  if (devolucao <= today) {
    throw new HttpsError(
      "invalid-argument",
      "A data de devolução deve ser futura.",
    );
  }
  const maxDate = dateInSaoPaulo(maxDias);
  if (devolucao > maxDate) {
    throw new HttpsError(
      "invalid-argument",
      `Prazo máximo de ${maxDias} dias.`,
    );
  }

  // Verifica se já existe empréstimo ativo para este produto
  const activeLoan = await db
    .collection("loans")
    .where("itemId", "==", itemId)
    .where("status", "in", ["reservado", "emprestado"])
    .limit(1)
    .get();
  if (!activeLoan.empty) {
    throw new HttpsError(
      "already-exists",
      "Este produto já possui um empréstimo ativo.",
    );
  }

  // Coleta códigos existentes para evitar colisões
  const allLoans = await db.collection("loans")
    .select("codigo", "codigoEntrega")
    .get();
  const usedCodes = new Set<string>();
  for (const doc of allLoans.docs) {
    const d = doc.data();
    if (d.codigo) usedCodes.add(d.codigo);
    if (d.codigoEntrega) usedCodes.add(d.codigoEntrega);
  }

  const codigo = generateCode(usedCodes);
  usedCodes.add(codigo);
  const codigoEntrega = generateCode(usedCodes);

  const loanRef = db.collection("loans").doc();
  await loanRef.set({
    itemId,
    userId: uid,
    nome: userData.name || "",
    contato: userData.email || "",
    devolucao,
    codigo,
    codigoEntrega,
    status: "reservado",
    criado: today,
  });

  return {
    id: loanRef.id,
    codigo,
    codigoEntrega,
  };
});

interface Loan {
  criado?: string;
  contato?: string;
  nome?: string;
  userId?: string;
  itemId?: string;
  inicio?: string;
  devolucao?: string;
  retirado?: string;
  codigo?: string;
  codigoEntrega?: string;
  status?: string;
  emailReminderStatus?: string;
  emailReminderClaimedAt?: Timestamp;
  emailReminderClaimToken?: string;
}

  // Envia um lembrete sob demanda, apenas para administradores autenticados
export const sendLoanReminder = onCall(
  {secrets: [smtpUser, smtpAppPassword]},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Entre para enviar um lembrete.");
    }

    const db = getFirestore();
    const adminProfile = await db
      .collection("users")
      .doc(request.auth.uid)
      .get();
    if (adminProfile.data()?.role !== "admin") {
      throw new HttpsError(
        "permission-denied",
        "Somente administradores podem enviar lembretes.",
      );
    }

    const loanId = request.data?.loanId;
    if (typeof loanId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(loanId)) {
      throw new HttpsError("invalid-argument", "Empréstimo inválido.");
    }

    try {
      const sent = await sendReminderOnce(db, loanId);
      return {success: true, alreadySent: !sent};
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      logger.error("Falha ao enviar lembrete manual", {
        loanId,
        errorCode: getErrorCode(error),
        responseCode: getResponseCode(error),
      });
      throw mapEmailError(error);
    }
  },
);


   // Envia lembretes de devolução diariamente às 09:00 (São Paulo), uma vez por empréstimo.
 
export const sendAutomaticLoanReminders = onSchedule(
  {
    schedule: "0 9 * * *",
    timeZone: "America/Sao_Paulo",
    secrets: [smtpUser, smtpAppPassword],
    retryCount: 3,
  },
  async () => {
    const db = getFirestore();
    const settings = await db.collection("settings").doc("app").get();
    const rawNoticeDays = settings.data()?.diasAviso ?? 1;
    const noticeDays = Number.isInteger(rawNoticeDays) ?
      Math.max(0, Math.min(rawNoticeDays, 365)) :
      1;
    const cutoffDate = dateInSaoPaulo(noticeDays);
    const loans = await db.collection("loans")
      .where("status", "==", "emprestado")
      .where("devolucao", "<=", cutoffDate)
      .get();
    const failures: string[] = [];

    for (const loanSnapshot of loans.docs) {
      try {
        await sendReminderOnce(db, loanSnapshot.id);
      } catch (error) {
        failures.push(loanSnapshot.id);
        logger.error("Falha ao enviar lembrete automático", {
          loanId: loanSnapshot.id,
          errorCode: getErrorCode(error),
          responseCode: getResponseCode(error),
        });
      }
    }

    if (failures.length) {
      throw new Error(
        `Falha ao enviar lembretes automáticos para ${failures.length} empréstimo(s).`,
      );
    }
  },
);

/**
 * Reserva e envia um lembrete de empréstimo no máximo uma vez
 * @param {FirebaseFirestore.Firestore} db Instância do Firestore
 * @param {string} loanId ID do documento do empréstimo
 * @return {Promise<boolean>} Se esta chamada enviou o e-mail
 */
async function sendReminderOnce(
  db: FirebaseFirestore.Firestore,
  loanId: string,
): Promise<boolean> {
  const loanRef = db.collection("loans").doc(loanId);
  const claimToken = randomUUID();
  const claimed = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(loanRef);
    if (!snapshot.exists) {
      throw new HttpsError("not-found", "Empréstimo não encontrado.");
    }

    const loan = snapshot.data() as Loan;
    if (loan.status !== "emprestado") {
      throw new HttpsError(
        "failed-precondition",
        "O lembrete só pode ser enviado para empréstimos em andamento.",
      );
    }
    if (loan.emailReminderStatus === "sent") return null;

    const claimTime = loan.emailReminderClaimedAt?.toMillis() || 0;
    if (
      loan.emailReminderStatus === "sending" &&
      Date.now() - claimTime < staleClaimMilliseconds
    ) {
      return null;
    }

    transaction.update(loanRef, {
      emailReminderStatus: "sending",
      emailReminderClaimedAt: FieldValue.serverTimestamp(),
      emailReminderClaimToken: claimToken,
    });
    return loan;
  });
  if (!claimed) return false;

  try {
    await deliverReminder(db, claimed);
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(loanRef);
      const current = snapshot.data() as Loan | undefined;
      if (current?.emailReminderClaimToken !== claimToken) return;
      transaction.update(loanRef, {
        emailReminderStatus: "sent",
        emailReminderSentAt: FieldValue.serverTimestamp(),
        emailReminderClaimedAt: FieldValue.delete(),
        emailReminderClaimToken: FieldValue.delete(),
      });
    });
    return true;
  } catch (error) {
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(loanRef);
      const current = snapshot.data() as Loan | undefined;
      if (current?.emailReminderClaimToken !== claimToken) return;
      transaction.update(loanRef, {
        emailReminderStatus: FieldValue.delete(),
        emailReminderClaimedAt: FieldValue.delete(),
        emailReminderClaimToken: FieldValue.delete(),
      });
    });
    throw error;
  }
}

/**
 * Compõe e envia um lembrete de empréstimo via SMTP do Gmail
 * @param {FirebaseFirestore.Firestore} db Instância do Firestore
 * @param {Loan} loan Dados do empréstimo para compor a mensagem
 * @return {Promise<void>} Resolve após o SMTP aceitar a mensagem
 */
async function deliverReminder(
  db: FirebaseFirestore.Firestore,
  loan: Loan,
): Promise<void> {
  const recipient = typeof loan.contato === "string" ?
    loan.contato.trim() :
    "";
  if (!emailPattern.test(recipient)) {
    throw new HttpsError(
      "failed-precondition",
      "Este empréstimo não possui um endereço de e-mail válido.",
    );
  }

  const itemSnapshot = loan.itemId ?
    await db.collection("items").doc(loan.itemId).get() :
    null;
  const itemName = itemSnapshot?.data()?.nome || "produto";
  const dueDate = typeof loan.devolucao === "string" ?
    loan.devolucao.split("-").reverse().join("/") :
    "consulte seu empréstimo";
  const returnCode = loan.codigoEntrega || loan.codigo || "não informado";
  const message = [
    `Olá, ${loan.nome || "usuário"}!`,
    "",
    `Este é um lembrete do ESTEAMULAB: a devolução de "${itemName}"`,
    `está prevista para ${dueDate}.`,
    `Código de devolução: ${returnCode}.`,
    "",
    "Atenciosamente,",
    "Equipe ESTEAMULAB",
  ].join("\n");

  let sender: string;
  let appPassword: string;
  try {
    sender = smtpUser.value().trim();
    appPassword = smtpAppPassword.value().replace(/\s/g, "");
  } catch (error) {
    logger.error("Segredos SMTP indisponíveis", {
      errorCode: getErrorCode(error),
    });
    throw new HttpsError(
      "failed-precondition",
      "O envio de e-mail não está configurado. Cadastre SMTP_USER e " +
        "SMTP_APP_PASSWORD nos segredos do Firebase e publique a função.",
    );
  }

  if (!emailPattern.test(sender) || !appPassword) {
    throw new HttpsError(
      "failed-precondition",
      "A conta remetente ou a senha de app do Gmail está ausente ou inválida.",
    );
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {user: sender, pass: appPassword},
  });
  await transporter.sendMail({
    from: `"ESTEAMULAB" <${sender}>`,
    to: recipient,
    subject: "Lembrete de devolução - ESTEAMULAB",
    text: message,
  });
}

/**
 * Retorna uma data ISO no fuso de São Paulo após o deslocamento em dias
 * @param {number} daysFromToday Número de dias a somar
 * @return {string} Data no format AAAA-MM-DD
 */
export function dateInSaoPaulo(daysFromToday: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value || "";
  const date = new Date(Date.UTC(
    Number(part("year")),
    Number(part("month")) - 1,
    Number(part("day")) + daysFromToday,
  ));
  return date.toISOString().slice(0, 10);
}

/**
 * Converte erros SMTP em erros callable seguros e acionáveis
 * @param {unknown} error Erro retornado pelo Nodemailer
 * @return {HttpsError} Erro adequado para o cliente callable
 */
function mapEmailError(error: unknown): HttpsError {
  const errorCode = getErrorCode(error);
  const responseCode = getResponseCode(error);
  logger.error("Falha ao enviar e-mail de lembrete", {errorCode, responseCode});

  if (errorCode === "EAUTH" || responseCode === 534 || responseCode === 535) {
    return new HttpsError(
      "failed-precondition",
      "O Gmail recusou a autenticação. Confira se SMTP_USER é a conta " +
        "remetente e se SMTP_APP_PASSWORD é uma senha de app válida dessa " +
        "mesma conta.",
    );
  }
  if (errorCode === "EENVELOPE" || responseCode === 550) {
    return new HttpsError(
      "failed-precondition",
      "O Gmail recusou o endereço de e-mail do destinatário.",
    );
  }
  return new HttpsError(
    "unavailable",
    `O Gmail não conseguiu enviar o e-mail (${errorCode || "SMTP"}). ` +
      "Verifique a conexão e tente novamente.",
  );
}

/**
 * Extrai o código de erro do Nodemailer sem expor credenciais
 * @param {unknown} error Erro SMTP a inspecionar
 * @return {string | undefined} Código do erro quando disponível
 */
function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ?
    error.code :
    undefined;
}

/**
 * Extrai o código de resposta SMTP para tratamento de erro
 * @param {unknown} error Erro SMTP a inspecionar
 * @return {number | undefined} Código de resposta quando disponível
 */
function getResponseCode(error: unknown): number | undefined {
  if (
    typeof error !== "object" ||
    error === null ||
    !("responseCode" in error)
  ) {
    return undefined;
  }
  return typeof error.responseCode === "number" ?
    error.responseCode :
    undefined;
}
