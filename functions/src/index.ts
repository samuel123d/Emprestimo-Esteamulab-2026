import {randomUUID} from "node:crypto";
import {initializeApp} from "firebase-admin/app";
import {FieldValue, getFirestore, Timestamp} from "firebase-admin/firestore";
import {logger, setGlobalOptions} from "firebase-functions";
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

interface Loan {
  contato?: string;
  nome?: string;
  itemId?: string;
  devolucao?: string;
  codigo?: string;
  codigoEntrega?: string;
  status?: string;
  emailReminderStatus?: string;
  emailReminderClaimedAt?: Timestamp;
  emailReminderClaimToken?: string;
}

/**
 * Sends a reminder on demand, only for an authenticated administrator.
 */
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
      logger.error("Manual loan reminder failed", {
        loanId,
        errorCode: getErrorCode(error),
        responseCode: getResponseCode(error),
      });
      throw mapEmailError(error);
    }
  },
);

/**
 * Sends due reminders daily at 09:00 in Sao Paulo, once per loan.
 */
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
        logger.error("Automatic loan reminder failed", {
          loanId: loanSnapshot.id,
          errorCode: getErrorCode(error),
          responseCode: getResponseCode(error),
        });
      }
    }

    if (failures.length) {
      throw new Error(
        `Failed to send automatic reminders for ${failures.length} loan(s).`,
      );
    }
  },
);

/**
 * Claims and sends a loan reminder at most once.
 * @param {FirebaseFirestore.Firestore} db Firestore instance.
 * @param {string} loanId Loan document ID.
 * @return {Promise<boolean>} Whether this call sent the email.
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
 * Composes and sends a loan reminder through Gmail SMTP.
 * @param {FirebaseFirestore.Firestore} db Firestore instance.
 * @param {Loan} loan Loan data to use in the message.
 * @return {Promise<void>} Resolves after SMTP accepts the message.
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
    logger.error("SMTP secrets are unavailable", {
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
 * Returns an ISO calendar date in Sao Paulo after the specified day offset.
 * @param {number} daysFromToday Number of days to add.
 * @return {string} ISO date in YYYY-MM-DD format.
 */
function dateInSaoPaulo(daysFromToday: number): string {
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
 * Converts SMTP errors to safe, actionable callable errors.
 * @param {unknown} error Error returned by Nodemailer.
 * @return {HttpsError} Error suitable for the callable client.
 */
function mapEmailError(error: unknown): HttpsError {
  const errorCode = getErrorCode(error);
  const responseCode = getResponseCode(error);
  logger.error("Failed to send loan reminder email", {errorCode, responseCode});

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
 * Safely extracts a Nodemailer error code without logging credentials.
 * @param {unknown} error SMTP error to inspect.
 * @return {string | undefined} Error code when available.
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
 * Safely extracts an SMTP response code for actionable error handling.
 * @param {unknown} error SMTP error to inspect.
 * @return {number | undefined} Response code when available.
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
