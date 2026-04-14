declare namespace NodeJS {
  interface ProcessEnv {
    TELEGRAM_BOT_TOKEN?: string;
    MONGODB_URI?: string;
    APP_BASE_URL?: string;
    OPENAI_API_KEY?: string;
    OPENAI_MODEL_INSIGHTS?: string;
  }
}
