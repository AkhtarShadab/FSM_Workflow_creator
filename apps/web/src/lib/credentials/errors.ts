export class CredentialNotFoundError extends Error {
  readonly credentialId: number;

  constructor(credentialId: number) {
    super("Credential not found");
    this.name = "CredentialNotFoundError";
    this.credentialId = credentialId;
  }
}

export class CredentialRevokedError extends Error {
  readonly code = "CREDENTIAL_REVOKED" as const;
  readonly credentialId: number;

  constructor(credentialId: number) {
    super("CREDENTIAL_REVOKED");
    this.name = "CredentialRevokedError";
    this.credentialId = credentialId;
  }
}
