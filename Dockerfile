# Use the latest Node.js LTS (Long Term Support) version as the base image
FROM node:21.7.3-slim

RUN apt-get update && apt-get install gnupg wget -y && \
  wget --quiet --output-document=- https://dl-ssl.google.com/linux/linux_signing_key.pub | gpg --dearmor > /etc/apt/trusted.gpg.d/google-archive.gpg && \
  sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' && \
  apt-get update && \
  apt-get install google-chrome-stable -y --no-install-recommends && \
  rm -rf /var/lib/apt/lists/*

# Set the working directory to /app
WORKDIR /app

# Copy the package.json and pnpm-lock.yaml files
COPY package.json pnpm-lock.yaml ./

# Install dependencies using pnpm
RUN npm install -g pnpm && pnpm install

# Copy the rest of the application code
COPY . .

# Set the build-time environment variables
ARG DATABASE_URL
ARG OPENAI_API_KEY
ARG OPENAI_ORG_ID
ARG GROQ_API_KEY
ARG COHERE_API_KEY
ARG MISTRAL_API_KEY
ARG ADMIN_EMAIL
ARG AI_PROVIDER
ARG DATABASE_PRIVATE_URL
ARG DATABASE_URL

# Set the runtime environment variables
ENV DATABASE_URL=${DATABASE_URL}
ENV OPENAI_API_KEY=${OPENAI_API_KEY}
ENV OPENAI_ORG_ID=${OPENAI_ORG_ID}
ENV GROQ_API_KEY=${GROQ_API_KEY}
ENV COHERE_API_KEY=${COHERE_API_KEY}
ENV MISTRAL_API_KEY=${MISTRAL_API_KEY}
ENV ADMIN_EMAIL=${ADMIN_EMAIL}
ENV AI_PROVIDER=${AI_PROVIDER}
ENV DATABASE_PRIVATE_URL=${DATABASE_PRIVATE_URL}
ENV DATABASE_URL=${DATABASE_URL}

# Build the TypeScript code and run Prisma migrations
RUN pnpm run build

# Start the application
CMD ["npm", "start"]

