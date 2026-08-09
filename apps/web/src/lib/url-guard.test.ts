import { describe, expect, it } from "vitest";
import { isPrivateAddress, validatePublicHttpUrl } from "./url-guard";

describe("isPrivateAddress", () => {
  it("flags private and loopback IPv4 ranges", () => {
    for (const ip of [
      "127.0.0.1",
      "10.0.0.5",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it("allows public IPv4", () => {
    for (const ip of ["8.8.8.8", "104.18.2.1", "172.15.0.1", "172.32.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it("flags loopback / link-local / unique-local / v4-mapped IPv6", () => {
    for (const ip of ["::1", "::", "fe80::1", "fd12::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    expect(isPrivateAddress("2606:4700::1")).toBe(false);
  });
});

describe("validatePublicHttpUrl", () => {
  it("accepts public https base URLs", () => {
    expect(validatePublicHttpUrl("https://api.openai.com/v1").ok).toBe(true);
    expect(validatePublicHttpUrl("http://example.com").ok).toBe(true);
  });

  it("rejects invalid URLs and non-http schemes", () => {
    expect(validatePublicHttpUrl("not a url").ok).toBe(false);
    expect(validatePublicHttpUrl("file:///etc/passwd").ok).toBe(false);
    expect(validatePublicHttpUrl("gopher://example.com").ok).toBe(false);
  });

  it("rejects localhost aliases and internal hostnames", () => {
    for (const u of [
      "http://localhost:11434",
      "http://foo.localhost",
      "http://metadata.google.internal",
      "http://service.internal",
      "http://printer.local",
    ]) {
      expect(validatePublicHttpUrl(u).ok, u).toBe(false);
    }
  });

  it("rejects private IP literals", () => {
    for (const u of [
      "http://127.0.0.1:8080",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]:3000",
      "http://192.168.0.10",
    ]) {
      expect(validatePublicHttpUrl(u).ok, u).toBe(false);
    }
  });
});
