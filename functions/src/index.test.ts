import {describe, it, expect, vi} from "vitest";

// Mock do firebase-admin para o initializeApp()não quebrar
vi.mock("firebase-admin/app", () => ({initializeApp: vi.fn()}));
vi.mock("firebase-admin/firestore", () => ({
  FieldValue: {serverTimestamp: vi.fn(), delete: vi.fn()},
  getFirestore: vi.fn(),
  Timestamp: {},
}));
vi.mock("firebase-functions", () => ({
  logger: {error: vi.fn()},
  setGlobalOptions: vi.fn(),
}));
vi.mock("firebase-functions/v2/https", () => ({
  HttpsError: class extends Error {},
  onCall: vi.fn((fn) => fn),
}));
vi.mock("firebase-functions/v2/scheduler", () => ({
  onSchedule: vi.fn((_, fn) => fn),
}));
vi.mock("firebase-functions/params", () => ({
  defineSecret: vi.fn(() => ({value: () => ""})),
}));
vi.mock("nodemailer", () => ({default: {createTransport: vi.fn()}}));

import {generateCode, dateInSaoPaulo} from "./index.js";

describe("generateCode", () => {
  it("gera código de 6 caracteres do alfabeto permitido", () => {
    const code = generateCode(new Set());
    expect(code).toHaveLength(6);
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  });

  it("evita códigos existentes", () => {
    const existing = new Set(["AAAAAA"]);
    for (let i = 0; i < 50; i++) {
      expect(generateCode(existing)).not.toBe("AAAAAA");
    }
  });
});

describe("dateInSaoPaulo", () => {
  it("retorna formato YYYY-MM-DD", () => {
    const result = dateInSaoPaulo(0);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("soma dias corretamente", () => {
    const hoje = dateInSaoPaulo(0);
    const amanha = dateInSaoPaulo(1);
    const hojeDate = new Date(hoje + "T00:00:00Z");
    const amanhaDate = new Date(amanha + "T00:00:00Z");
    const diffMs = amanhaDate.getTime() - hojeDate.getTime();
    expect(diffMs).toBe(86400000);
  });
});
