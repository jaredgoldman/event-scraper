export const AI_PROVIDERS = {
  OPENAI: 'OPENAI',
  ANTHROPIC: 'ANTHROPIC',
  GOOGLE: 'GOOGLE',
  // GROQ: 'GROQ',
  // COHERE: 'COHERE',
} as const

export const AI_PROVIDER_NAMES = Object.values(AI_PROVIDERS)

export type AI_PROVIDER = (typeof AI_PROVIDERS)[keyof typeof AI_PROVIDERS]
