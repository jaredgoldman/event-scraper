import * as envalid from 'envalid'

type EnvConfig = {
  DATABASE_URL: string
  OPENAI_API_KEY: string
  OPENAI_ORG_ID: string
  ANTHROPIC_API_KEY: string
  GOOGLE_API_KEY: string
  ADMIN_EMAIL: string
  AI_PROVIDER: string
  DEBUG_LEVEL: string
  CRON_SCHEDULE: string
  NODE_ENV: string
  CHUNK_LIMIT: number
  SCHEDULE_CHRON: boolean
  TIMEZONE: string
}

/**
 * Validate and return the environment variables.
 * @returns {EnvConfig} - The environment variables.
 */
export const env = envalid.cleanEnv(process.env, {
  DATABASE_URL: envalid.str({
    desc: 'The database url',
  }),
  OPENAI_API_KEY: envalid.str({
    desc: 'The open ai api key',
  }),
  OPENAI_ORG_ID: envalid.str({
    desc: 'The open ai org id',
  }),
  ANTHROPIC_API_KEY: envalid.str({
    desc: 'The anthropic api key',
  }),
  GOOGLE_API_KEY: envalid.str({
    desc: 'The google api key',
  }),
  ADMIN_EMAIL: envalid.str({
    desc: 'Email address for seed admin',
  }),
  AI_PROVIDER: envalid.str({
    desc: 'The AI model to use',
    choices: ['OPENAI', 'GROQ', 'COHERE', 'ANTHROPIC', 'GOOGLE'],
  }),
  DEBUG_LEVEL: envalid.str({
    desc: 'The debug level',
    choices: ['info', 'warn', 'error', 'debug'],
    default: 'info',
  }),
  CRON_SCHEDULE: envalid.str({
    desc: 'The schedule for the chron job',
    default: '0 0 * * *',
  }),
  CHUNK_LIMIT: envalid.num({
    desc: 'The amount of chunks we want to send to llm',
    default: 100,
  }),
  NODE_ENV: envalid.str({
    desc: 'The node environment',
    choices: ['development', 'production', 'test'],
    default: 'development',
  }),
  SCHEDULE_CHRON: envalid.bool({
    desc: 'Whether to schedule the chron job',
    default: false,
  }),
  TIMEZONE: envalid.str({
    desc: 'The timezone to use',
    default: 'America/Toronto',
  }),
}) as EnvConfig
