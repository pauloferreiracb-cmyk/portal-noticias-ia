/// <reference path="../.astro/types.d.ts" />

interface ImportMetaEnv {
  readonly RESEND_API_KEY: string;
  readonly RESEND_AUDIENCE_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}