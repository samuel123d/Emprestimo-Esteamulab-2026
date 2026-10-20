import {describe, it, expect, beforeAll, beforeEach} from "vitest";
import {initializeApp, type FirebaseApp} from "firebase/app";
import {
  getAuth,
  connectAuthEmulator,
  signInAnonymously,
  signOut,
} from "firebase/auth";
import {
  getFirestore,
  connectFirestoreEmulator,
} from "firebase/firestore";
import {
  getFunctions,
  connectFunctionsEmulator,
  httpsCallable,
} from "firebase/functions";
import {initializeApp as initializeAdminApp} from "firebase-admin/app";
import {getFirestore as getAdminFirestore} from "firebase-admin/firestore";

const PROJECT_ID = "emprestimo-2026";
const FIRESTORE_HOST = "127.0.0.1:8080";
let app: FirebaseApp;
let db: ReturnType<typeof getFirestore>;
let fn: ReturnType<typeof getFunctions>;
let auth: ReturnType<typeof getAuth>;
const adminApp = initializeAdminApp({projectId: PROJECT_ID}, "test-seed");
const adminDb = getAdminFirestore(adminApp);

beforeAll(() => {
  app = initializeApp({projectId: PROJECT_ID, apiKey: "fake-api-key"});
  auth = getAuth(app);
  db = getFirestore(app);
  fn = getFunctions(app, "us-central1");

  connectAuthEmulator(auth, "http://127.0.0.1:9099", {disableWarnings: true});
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFunctionsEmulator(fn, "127.0.0.1", 5001);
});

// Limpa o Firestore entre testes para evitar vazamento de estado
beforeEach(async () => {
  await fetch(
    `http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    {method: "DELETE"},
  );
});

async function seedItemEUsuario(uid: string) {
  await adminDb.doc("items/testItem").set({nome: "Arduino Uno"});
  await adminDb.doc(`users/${uid}`).set({
    name: "Test User",
    email: "test@example.com",
    role: "user",
  });
  await adminDb.doc("settings/app").set({maxDias: 30, diasAviso: 1});
}

function dataFutura(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

describe("createLoan E2E", () => {
  it("cria um empréstimo (caminho feliz)", async () => {
    const cred = await signInAnonymously(auth);
    const uid = cred.user.uid;
    await seedItemEUsuario(uid);

    const createLoan = httpsCallable(fn, "createLoan");
    const result = await createLoan({
      itemId: "testItem",
      devolucao: dataFutura(7),
    });

    const data = result.data as {id: string; codigo: string; codigoEntrega: string};
    expect(data.id).toBeTruthy();
    expect(data.codigo).toHaveLength(6);
    expect(data.codigoEntrega).toHaveLength(6);

    const loanDoc = await adminDb.doc(`loans/${data.id}`).get();
    expect(loanDoc.exists).toBe(true);
    expect(loanDoc.data()?.status).toBe("reservado");

    await signOut(auth);
  });

  it("rejeita empréstimo duplicado para o mesmo item", async () => {
    const cred = await signInAnonymously(auth);
    const uid = cred.user.uid;
    await seedItemEUsuario(uid);

    const createLoan = httpsCallable(fn, "createLoan");
    await createLoan({itemId: "testItem", devolucao: dataFutura(7)});

    // Segundo empréstimo para o mesmo item deve falhar
    await expect(
      createLoan({itemId: "testItem", devolucao: dataFutura(7)}),
    ).rejects.toThrow(/already-exists|já possui/i);

    await signOut(auth);
  });

  it("rejeita chamada sem autenticação", async () => {
    await signOut(auth);
    const createLoan = httpsCallable(fn, "createLoan");
    await expect(
      createLoan({itemId: "testItem", devolucao: dataFutura(7)}),
    ).rejects.toThrow(/unauthenticated|Entre para/i);
  });

  it("rejeita data de devolução no passado", async () => {
    const cred = await signInAnonymously(auth);
    const uid = cred.user.uid;
    await seedItemEUsuario(uid);

    const createLoan = httpsCallable(fn, "createLoan");
    const dataPassada = "2020-01-01";

    await expect(
      createLoan({itemId: "testItem", devolucao: dataPassada}),
    ).rejects.toThrow(/invalid-argument|futura/i);

    await signOut(auth);
  });

  it("rejeita item inexistente", async () => {
    const cred = await signInAnonymously(auth);
    const uid = cred.user.uid;
    await adminDb.doc(`users/${uid}`).set({
      name: "Test User",
      email: "test@example.com",
      role: "user",
    });

    const createLoan = httpsCallable(fn, "createLoan");

    await expect(
      createLoan({itemId: "itemInexistente", devolucao: dataFutura(7)}),
    ).rejects.toThrow(/not-found|não encontrado/i);

    await signOut(auth);
  });
});
