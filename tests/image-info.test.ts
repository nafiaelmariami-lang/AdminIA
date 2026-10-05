import { describe, expect, it } from "vitest";
import { readImageSize } from "@/server/documents/image-info";
import { makeJpegHeader, makePng } from "./fixtures";

describe("lecture des dimensions d'image (sans décodage)", () => {
  it("PNG", () => expect(readImageSize(makePng(321, 654), "image/png")).toEqual({ width: 321, height: 654 }));
  it("JPEG", () => expect(readImageSize(makeJpegHeader(3024, 4032), "image/jpeg")).toEqual({ width: 3024, height: 4032 }));
  it("WEBP (VP8X)", () => {
    const b = Buffer.alloc(40);
    b.write("RIFF", 0, "latin1");
    b.write("WEBPVP8X", 8, "latin1");
    b.writeUIntLE(1999, 24, 3);
    b.writeUIntLE(2999, 27, 3);
    expect(readImageSize(b, "image/webp")).toEqual({ width: 2000, height: 3000 });
  });
  it("renvoie null pour un en-tête tronqué ou incohérent", () => {
    expect(readImageSize(Buffer.from([0x89, 0x50]), "image/png")).toBeNull();
    expect(readImageSize(Buffer.from([0xff, 0xd8, 0x00, 0x00, 0, 0, 0, 0, 0, 0, 0, 0]), "image/jpeg")).toBeNull();
    expect(readImageSize(Buffer.alloc(40), "image/webp")).toBeNull();
  });
});
