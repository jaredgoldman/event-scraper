# Event Scraper

## Overview

Event Scraper is designed to scrape event data from various venues, process the events, and store them in a database. This service uses Node.js, Prisma ORM, Puppeteer and Langchain to extract and normalize event information. The scraper is intended to be used for [jazzintoronto](https://jazzintoronto.com) and currently but can be used for extracting events of any kind. Contributions are welcome to extend the functionality of the scraper.

## Installation

To install the necessary dependencies, run:

```bash
pnpm i
```

## Database

The service uses a PostgreSQL database to store event information. The database connection is managed using Prisma ORM. To set up the database, run the following command:

```bash
pnpm run db:setup
```

## Configuration

Configuration settings are managed through environment variables. Take a look at `/src/config/env.ts` to see the available configuration options.

## Usage

### Running the Service

To start the service, use the following command:

```bash
pnpm run start
```

The service will scrape events based on the configuration and environment.

You can also run the service in development mode using the following command:

```bash
pnpm run dev
```

### Environments

- **Production**: The service runs based on a cron schedule specified in the `CRON_SCHEDULE` environment variable.
- **Development & Test**: The service runs continuously in a loop.

## Logging

Logging is initialized using the `initLog` function from the `services/logger` module. Different log levels are used to capture relevant information:

- `info`: General information about the scraping process.
- `debug`: Detailed information for debugging purposes.
- `warn`: Warnings about potential issues, such as no events found.
- `error`: Errors encountered during the scraping process.

## Contribution

If you'd like to contribute to this project, please fork the repository and use a feature branch. Pull requests are welcome.

## License

This project is licensed under the MIT License.

---

Feel free to customize this README further based on your specific requirements or any additional features you may have.
