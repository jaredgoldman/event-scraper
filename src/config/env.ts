import * as envalid from "envalid";

type EnvConfig = {
  DATABASE_URL: string;
  OPENAI_API_KEY: string;
  OPENAI_ORG_ID: string;
};

const env = envalid.cleanEnv(process.env, {
  DATABASE_URL: envalid.str({
    desc: "The database url",
  }),
  OPENAI_API_KEY: envalid.str({
    desc: "The open ai api key",
  }),
  OPENAI_ORG_ID: envalid.str({
    desc: "The open ai org id",
  }),
});

export default env as EnvConfig;
