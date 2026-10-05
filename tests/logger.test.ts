import { describe, expect, it } from "vitest";
import { redact } from "@/server/logger";

describe("journalisation : masquage des données sensibles", () => {
  it("masque mots de passe, jetons, clés, contenus et prompts, à toute profondeur", () => {
    const out = redact({
      userId: "u1",
      password: "secret",
      token: "abc",
      apiKey: "sk-ant-xxx",
      nested: { authorization: "Bearer x", content: "texte du document", prompt: "…", ok: 1 },
      list: [{ cookie: "s=1" }],
    }) as Record<string, unknown>;
    expect(out.userId).toBe("u1");
    expect(JSON.stringify(out)).not.toMatch(/secret|abc|sk-ant|Bearer|texte du document|s=1/);
    expect((out.nested as Record<string, unknown>).ok).toBe(1);
  });

  it("tronque les longues chaînes et résume les erreurs", () => {
    expect((redact("x".repeat(2000)) as string).length).toBeLessThan(600);
    expect(redact(new Error("boom"))).toEqual({ name: "Error", message: "boom" });
  });
});
