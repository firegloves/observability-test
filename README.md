# Observability test

## Overview

This project generates observability data via **RESTful API endpoints**. 

## Project Structure

The application follows the **Hexagonal Architecture** (Ports and Adapters). This architectural style emphasizes a separation of concerns, keeping the core business logic (domain) independent from external technologies like frameworks, databases, or UI.

**Dependency Injection (DI)** and **Inversion of Control (IoC)** are key principles applied throughout the application, facilitated by the [Awilix](https://github.com/jeffijoe/awilix) library and `@fastify/awilix`. This allows for decoupling components and makes the application more testable and maintainable.

**Functional Error Handling & Optionals**: Inspired by Rust, the project leverages the [oxide.ts](https://github.com/vriad/oxide.ts) library to handle errors and optional values using `Result<T, E>` (`Ok`, `Err`) and `Option<T>` (`Some`, `None`). This promotes explicit error handling paths (avoiding exceptions for control flow) and reduces issues related to `null` or `undefined`.

The main directories within `src` reflect this structure:

*   `domain`: Contains the core business logic, independent of any framework or infrastructure.
    *   `entity`: Defines the core domain objects (aggregates, entities, value objects).
    *   `use-case`: Implements the application-specific business rules and orchestrates domain entities.
*   `app`: Orchestrates the use cases by coordinating the domain layer and the infrastructure adapters. It also includes the server setup (`server.ts`) and DI container configuration (`container.ts`).
*   `repository`: Contains the infrastructure implementations (adapters) for data persistence (e.g., `PostgresBookRepo`).
*   `route`: Defines the API endpoints and handles incoming requests, acting as primary adapters (input adapters).
*   `db`: Includes database migration scripts and seeding logic.
*   `utils`: Holds shared utility functions.

## Prerequisites

Before you begin, ensure you have met the following requirements:
*   You have installed Node.js (version `22.15.0` or compatible `22.x`)
*   You have installed `pnpm` (version `10.9.0` or compatible)
*   You have installed Docker and Docker Compose

## Installation

Install the project dependencies using `pnpm`:

```bash
pnpm install
```

## Environment Variables

The application requires the following environment variables. You can define them in a `.env` file in the project root to override the default values.

*   `PORT`: Port the server listens on (Default: `8080`)
*   `NODE_ENV`: Environment (`development`, `production`, `test`) (Default: `development`)
*   `DB_HOST`: Database host (Default: `localhost`)
*   `DB_PORT`: Database port (Default: `5432`)
*   `DB_USER`: Database user (Default: `library_user`)
*   `DB_PASSWORD`: Database password (Default: `library_password`)
*   `DB_NAME`: Database name (Default: `library_service`)
*   `OPENAPI_SPEC_FILE_DESTINATION`: Path for generated OpenAPI spec (Default: `generated/openapi-schema.json`)

Create a `.env` file in the root directory if you need to customize these settings:

```dotenv
# .env example
PORT=3000
DB_HOST=127.0.0.1
# ... other variables
```


## Running the App

### Development

To run the application in development mode with hot-reloading:

```bash
pnpm dev
```

This command will:
1.  Start the PostgreSQL database using Docker Compose (`observability-test-db` service).
2.  Wait for the database to be ready.
3.  Apply database migrations.
4.  Seed the database (if seed data exists).
5.  Start the application using `esbuild` for building and `node` with the `--watch` flag.

Ensure Docker is running before executing this command.

### Production

To run the application in production mode:

1.  Build the application:
    ```bash
    pnpm build
    ```
2.  Start the server:
    ```bash
    pnpm start
    ```

This requires a `.env` file to be configured with appropriate production values (especially for the database) and assumes a PostgreSQL database is running and accessible based on the environment variables.

## API Documentation

This service uses Fastify with `@fastify/swagger` and `@fastify/swagger-ui` to provide API documentation.

### API Versioning

The API uses **URL Path Versioning**. All routes are prefixed with the version number. Currently, the active version is `v1`.

Example: `/v1/foo`

### Standard Response Format (Envelope)

All API responses follow a standard envelope format using a discriminated union based on the `success` field:

*   **Success Response (`success: true`)**
    ```json
    {
      "success": true,
      "data": { ... } // Actual response payload
    }
    ```
*   **Error Response (`success: false`)**
    ```json
    {
      "success": false,
      "error": "Error message description"
    }
    ```

This structure provides a consistent way to handle both successful results and errors across all endpoints.

### Swagger UI

When the application is running in development mode (`pnpm dev`), you can access the interactive Swagger UI documentation by navigating to:

[http://localhost:PORT/docs](http://localhost:PORT/docs)

Replace `PORT` with the actual port the server is running on (default is `8080`).

Additionally, when `NODE_ENV` is not set to `production`, the OpenAPI specification file is automatically generated and saved to the path specified by the `OPENAPI_SPEC_FILE_DESTINATION` environment variable (default: `generated/openapi-schema.json`).

### Multi-step Review + Book Update

- **Endpoint**: `POST /v1/reviews/create-and-update-book`
- **Description**: Creates a review and updates the associated book (average_rating, review_count) in a single atomic operation. Tracing: parent span for the operation, child spans for each step, custom attributes propagation.
- **Request Example**:
```json
{
  "book_id": 1,
  "user_id": 1,
  "rating": 5,
  "comment": "Test multi-step"
}
```
- **Response Example**:
```json
{
  "success": true,
  "data": {
    "review": { ... },
    "updatedBook": { ... }
  }
}
```
- **Observability Data Generated**:
  - **Metrics**:
    - `multi_step_review_book_update_requests_total` (Counter): Total multi-step operations
    - `multi_step_review_book_update_duration_seconds` (Histogram): Total operation duration
    - `review_creation_duration_seconds` (Histogram): Review creation step
    - `book_update_duration_seconds` (Histogram): Book update step
  - **Tracing**:
    - Parent span: `MultiStepReviewBookUpdate`
    - Child spans: `CreateReview`, `UpdateBook`
    - Custom attributes: `user.id`, `book.id`, `operation.type`, `step`, `review.rating`, `review.id`, `book.average_rating`, `book.review_count`
    - **Span events**: `review_created`, `book_updated`, `multi_step_completed`, `error` (with detailed attributes)
    - **Trace correlation**: parent-child relationship, error propagation, ability to follow the full operation and its errors
    - **Error correlation**: each error generates an `error` event and specific attributes, filterable and correlatable in traces
  - **Logging**:
    - Structured logs for each step with context (user, book, operation)
    - Error logs with full context, trace id, and span id for correlation
    - Success logs with review and book data

## Load Testing with k6

This project includes a comprehensive **k6 load testing infrastructure** designed to generate realistic observability data for testing monitoring platforms like SignOz and GCP.

### Overview

The k6 setup provides:
- **Realistic user scenarios**: Read-heavy operations, write operations, performance testing, and error simulation
- **Multiple environments**: Local, staging, and production configurations
- **Custom metrics**: Performance tracking and observability validation
- **Weighted scenarios**: Simulates realistic user behavior patterns (60% reads, 25% writes, 10% performance tests, 5% errors)
- **Think times**: Human-like delays between operations
- **Session management**: Simulated user sessions with persistence

### Quick Start

1. **Install k6** (if not already installed):
   ```bash
   # macOS (using Homebrew)
   brew install k6
   
   # Or download from https://k6.io/docs/get-started/installation/
   ```

2. **Start the application**:
   ```bash
   pnpm dev
   ```

3. **Run load tests**:
   ```bash
   # Navigate to load tests directory
   cd load-tests
   
   # Quick 1-minute test (great for development)
   ./run-tests.sh local baseline-performance quick
   
   # Short 5-minute test 
   ./run-tests.sh local baseline-performance short
   
   # Full 17-minute test (realistic load simulation)
   ./run-tests.sh local baseline-performance long
   ```

### Test Structure

```
load-tests/
├── config/
│   └── environments.js          # Environment configurations (local/staging/prod)
├── scenarios/
│   └── baseline-performance.js  # Main test scenarios
├── utils/
│   └── data-generators.js       # Realistic data generation
├── run-tests.sh                 # Test runner script
└── README.md                    # Detailed k6 documentation
```

### Test Scenarios

The load tests simulate 4 main user behaviors:

1. **Read Heavy (60%)**: Health checks + book fetching
2. **Write Operations (25%)**: Creating book reviews
3. **Performance Testing (10%)**: Testing slow endpoints with various latencies
4. **Error Simulation (5%)**: Triggering controlled errors for monitoring

### Custom Metrics

The tests track custom observability metrics:
- `custom_success_requests`: Success rate tracking
- `endpoint_response_time`: Response time distribution
- `slow_endpoint_accuracy`: Latency simulation accuracy

### Environment Configuration

Three pre-configured environments:
- **Local**: `http://localhost:8081` - For development
- **Staging**: `https://staging.example.com` - For pre-production testing  
- **Production**: `https://api.example.com` - For production load testing

### Performance Thresholds

Built-in performance validation:
- HTTP error rate < 10%
- 95th percentile response time < 500ms
- Success rate > 85%
- Slow endpoint accuracy within 50ms

For detailed k6 documentation, configuration options, and advanced usage, see [load-tests/README.md](./load-tests/README.md).

## Code Quality & Formatting

This project uses [Biome](https://biomejs.dev/) for code formatting and linting, and [Husky](https://typicode.github.io/husky/) with [lint-staged](https://github.com/okonet/lint-staged) to enforce code quality standards before commits.

*   **Pre-commit Hook**: Before each commit, Husky runs `lint-staged`, which in turn executes `biome check --apply` on the staged files (`.ts`, `.js`, `.tsx`, `.jsx`, `.json`). This automatically formats the code and fixes linting issues according to the rules defined in `biome.json`.
*   **Manual Checks**: You can manually format or lint the entire codebase using the following commands:
    *   `pnpm biome:format`: Formats all files in `src`.
    *   `pnpm biome:lint`: Lints all files in `src` and applies fixes.
    *   `pnpm biome:check`: Runs both formatting and linting checks with fixes.

## Dashboards

Example dashboard configurations are provided for both SignOz and Google Cloud Platform (GCP) to visualize observability data generated by this application.

- **Location**: `docs/dashboards/`
  - `signoz-example-dashboard.json`: Importable dashboard for SignOz
  - `gcp-example-dashboard.json`: Importable dashboard for GCP Cloud Monitoring

### Main Widgets
- **Request Rate (RPS)**: Shows the number of multi-step review+book update operations per second
- **Error Rate**: Shows the number of errors per second in multi-step operations
- **Latency (p95)**: Visualizes the 95th percentile latency for multi-step operations
- **Recent Multi-step Traces**: Table or log panel showing recent traces or errors for the multi-step operation

### How to Use
- **SignOz**: Import the JSON file via the SignOz dashboard import feature
- **GCP**: Import the JSON file in Cloud Monitoring > Dashboards > Create/Import

These dashboards help teams monitor SLI/SLOs, error rates, latency, and trace correlation for the most critical business operations.

## Alerts

Example alert rule configurations are provided for both SignOz and Google Cloud Platform (GCP) to monitor SLI/SLOs for the multi-step review+book update operation.

- **Location**: `docs/alerts/`
  - `signoz-alerts.yaml`: Importable alert rules for SignOz
  - `gcp-alerts.json`: Importable alerting policies for GCP Cloud Monitoring

### Main Alert Conditions
- **High Error Rate**: Triggers if error rate >2% in the last 5 minutes
- **High p95 Latency**: Triggers if p95 latency >500ms in the last 5 minutes
- **No Requests**: Triggers if no requests are detected in the last 5 minutes (availability drop)

### How to Use
- **SignOz**: Import the YAML file via the SignOz alert rules import feature
- **GCP**: Import the JSON file in Cloud Monitoring > Alerting > Create/Import Policy

These alerts help teams proactively monitor reliability and performance SLOs for critical business operations.