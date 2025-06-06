# k6 Load Testing for Observability Test

This directory contains a comprehensive k6 load testing infrastructure designed to generate realistic observability data for testing monitoring platforms like SignOz and GCP.

## 📁 Structure

```
load-tests/
├── config/
│   └── environments.js      # Environment configurations (local, staging, prod)
├── utils/
│   └── data-generators.js   # Test data generation utilities
├── scenarios/
│   ├── modules/
│   │   ├── README.md                      # Module documentation
│   │   └── database-heavy-operations.js  # Shared database testing module
│   ├── baseline-performance.js           # ✅ EXECUTABLE: Main baseline test
│   └── database-heavy-only.js           # ✅ EXECUTABLE: Focused database test  
├── results/                 # Test results (auto-created)
├── run-tests.sh            # Test runner script
└── README.md               # This file
```

### 🏗️ Architecture Principles

**Clear Separation of Concerns:**
- **`scenarios/`**: Contains only **executable test files**
- **`scenarios/modules/`**: Contains only **reusable components**  
- **`utils/`**: Contains **data generation utilities**
- **`config/`**: Contains **environment-specific settings**

**Module Reusability:**
- Database operations logic is **shared** between baseline and focused tests
- **Consistent metrics** across different test scenarios
- **DRY principle** - no code duplication
- **Easy maintenance** - update logic in one place

**Human-Friendly Organization:**
- Clear distinction between **runnable tests** vs **shared modules**
- **Descriptive file names** (`database-heavy-operations.js` vs `database-heavy.js`)
- **Documentation** in modules directory explaining usage
- **No confusion** about what can be executed directly

## 🚀 Quick Start

### Prerequisites
- k6 installed (`brew install k6`)
- Application running (`pnpm dev`)
- jq for results analysis (`brew install jq` - optional)

### Run Tests

```bash
# Quick test (1 min, 5 users)
./load-tests/run-tests.sh local baseline-performance quick

# Standard test (17 min total, realistic load)
./load-tests/run-tests.sh local baseline-performance short

# Extended test (35 min, up to 100 users)
./load-tests/run-tests.sh local baseline-performance long

# NEW: Database Heavy Focused Test (9 min, database operations only)
k6 run --duration 5m --vus 10 load-tests/scenarios/database-heavy-only.js

# Manual database heavy test (custom parameters)
k6 run --stage 1m:5 --stage 3m:15 --stage 2m:25 --stage 2m:10 --stage 1m:0 load-tests/scenarios/database-heavy-only.js
```

### Test Scenarios

#### **Baseline Performance Test**
- **File**: `scenarios/baseline-performance.js`
- **Duration**: 17 minutes (configurable)
- **Load Pattern**: Ramp up → Steady → Peak → Ramp down
- **Scenarios**:
  - 50% Read operations (fetch books, health checks)
  - 20% Write operations (create reviews)
  - 15% **Database heavy operations** (NEW!)
  - 10% Performance testing (slow endpoint with various latencies)
  - 5% Error simulation

#### **Database Heavy Operations Test** (NEW!)
- **Files**: 
  - `scenarios/modules/database-heavy-operations.js` - Shared operations module
  - `scenarios/database-heavy-only.js` - Focused testing scenario
- **Duration**: 9 minutes (focused test) or integrated in baseline
- **Operations**:
  - **30% Stats**: Database statistics aggregation
  - **25% Complex JOIN**: Multi-table JOIN queries with review stats
  - **25% Aggregation**: Rating analysis, author popularity, temporal analysis
  - **20% Slow Query**: PostgreSQL sleep simulation (1-3 seconds)
- **Response Time Expectations**:
  - Stats: < 1 second
  - Complex JOIN: < 2 seconds  
  - Aggregation: < 1.5 seconds
  - Slow Query: < 5 seconds
- **Observability Features**:
  - Operation-specific metrics and tracing
  - Performance impact classification
  - Detailed execution time logging
  - Custom span attributes for filtering

#### **Load Stages**:
1. **Ramp up**: 2 min → 10 users
2. **Steady**: 5 min @ 25 users
3. **Peak ramp**: 3 min → 50 users
4. **Peak steady**: 5 min @ 50 users
5. **Ramp down**: 2 min → 0 users

## 📊 Generated Data Types

### **Performance Metrics**
- Request duration distributions
- Throughput (requests per second)
- Error rates by endpoint
- Latency accuracy for slow endpoint

### **OpenTelemetry Data**
- Distributed traces across all endpoints
- Custom span attributes for filtering
- Performance timing correlation
- Error trace correlation

### **Custom Metrics**
- `custom_success_requests`: Successful operations counter
- `custom_error_requests`: Failed operations counter
- `endpoint_response_time`: Response time distribution
- `slow_endpoint_accuracy`: Latency simulation accuracy
- **Database Heavy Metrics**:
  - `database_heavy_operations_total`: Total database operations by type
  - `database_heavy_response_time_ms`: Response time by operation type
  - `database_heavy_success_total`: Successful database operations
  - `database_heavy_error_total`: Failed database operations

- **CPU Intensive Metrics**:
  - `cpu_operations_total`: Total CPU operations by computation type
  - `cpu_execution_time_ms`: Execution time by computation type and intensity
  - `cpu_utilization_estimate`: CPU utilization estimate by operation
  - `cpu_custom_iterations_total`: Operations using custom iteration counts

- **Database Error Scenario Metrics**:
  - `database_errors_requests_total`: Total error scenario requests by type and context
  - `database_errors_errors_total`: Failed error scenario attempts with error codes
  - `database_errors_recoveries_total`: Successful error recoveries by type
  - `database_errors_success_rate`: Overall error scenario success rate by type
  - `database_errors_recovery_rate`: Recovery success rate by error type
  - `database_errors_execution_time_ms`: Total execution time including retries
  - `database_errors_recovery_time_ms`: Time to recover from errors
  - `database_errors_retry_attempts`: Number of retry attempts per scenario

- **Timeout Scenario Metrics** (NEW!):
  - `timeout_scenario_requests_total`: Total timeout requests by scenario and service context
  - `timeout_scenario_errors_total`: Failed timeout operations by error type
  - `timeout_scenario_success_rate`: Success rate by timeout scenario type
  - `timeout_scenario_execution_time_ms`: Execution time distribution for timeout tests
  - `timeout_circuit_breaker_events`: Circuit breaker state change events
  - `timeout_scenario_duration_actual`: Actual processing time vs timeout threshold
  - `timeout_circuit_breaker_state_changes`: Circuit breaker state transitions by service

## 🎯 Test Thresholds

### **Local Environment**
- P95 response time: < 500ms
- Error rate: < 10%
- Success rate: > 85%
- Slow endpoint accuracy: < 50ms difference
- **Database Error Scenarios**:
  - Success rate: > 15% (due to high failure rates)
  - Recovery rate: > 20%
  - Execution time p95: < 15 seconds
  - Average retry attempts: < 3

### **Production Environment**
- P95 response time: < 200ms
- Error rate: < 1%
- Success rate: > 99%
- **Database Error Scenarios**:
  - Success rate: > 25% (better in production)
  - Recovery rate: > 40%
  - Execution time p95: < 10 seconds
  - Average retry attempts: < 2

## 📈 Results Analysis

Results are saved as JSON files in the `results/` directory with timestamps:
```
results/k6-results-baseline-performance-local-20250530_141530.json
```

### **Manual Analysis**
```bash
# View raw results
cat results/k6-results-*.json | jq '.'

# Get summary statistics
cat results/k6-results-*.json | jq -s '
  [.[] | select(.type == "Point" and .metric == "http_req_duration")] |
  {
    total_requests: length,
    avg_response_time: (map(.data.value) | add / length),
    p95_response_time: (sort_by(.data.value) | .[length * 0.95 | floor].data.value)
  }
'
```

## 🔧 Configuration

### **Environment Variables**
- `ENVIRONMENT`: Target environment (local, staging, production)
- Custom thresholds per environment in `config/environments.js`

### **Test Customization**
- Modify load patterns in scenario files
- Adjust user behavior weights in `utils/data-generators.js`
- Add new test scenarios by creating new files in `scenarios/`

## 🧪 Test Data Characteristics

### **Realistic User Behavior**
- Weighted scenario distribution (read-heavy realistic pattern)
- Random think time between requests (1-5 seconds)
- User session tracking with IDs
- Multiple operation types for performance testing

### **Observability Focus**
- Custom headers for trace correlation
- Performance test markers for filtering
- Error simulation for alert testing
- Latency accuracy validation

## 🎯 SignOz vs GCP Comparison

This test suite generates data specifically designed to compare observability platforms:

### **Metrics Comparison**
- Request rate and duration distributions
- Error rate tracking and alerting
- Custom business metrics visualization
- Resource usage correlation

### **Tracing Comparison**
- Distributed trace visualization
- Performance bottleneck identification
- Error trace correlation
- Custom span attribute filtering

### **Dashboard Comparison**
- Real-time metrics visualization
- Historical trend analysis
- Alert configuration and triggering
- Query performance and flexibility

## 📊 Test Scenarios - What They Reveal

### **🎯 Baseline Performance Test - Application Health Baseline**

**What it simulates**: Real user traffic with mixed operations  
**What you can observe**:

- **Application Stability**: Measure baseline performance under realistic load
- **Capacity Planning**: Understand how the system behaves with 10-50 concurrent users
- **Resource Utilization**: CPU, memory, database connections under normal conditions
- **Error Rate Trends**: Identify if specific operations are more error-prone
- **Response Time Distribution**: P50, P95, P99 latencies across different endpoints

**Key Insights for Teams**:
- **SRE Teams**: Set realistic SLOs based on observed baseline metrics
- **Product Teams**: Understand user experience quality under normal traffic
- **Infrastructure Teams**: Capacity planning and scaling decision data
- **Development Teams**: Performance regression detection in CI/CD

**What to watch for**:
- Consistent response times across all operation types
- Error rates staying below 5% (indicating system stability)
- Memory/CPU not exceeding 70% under normal load
- Database connection pool not exhausted

---

### **💾 Database Heavy Operations - Database Performance Analysis**

**What it simulates**: Database-intensive workloads and performance bottlenecks  
**What you can observe**:

- **Database Performance Limits**: How the system behaves under database stress
- **Query Optimization Opportunities**: Identify slow query patterns
- **Connection Pool Management**: Database connection efficiency
- **Caching Effectiveness**: Cache hit/miss rates under heavy DB load
- **Resource Contention**: Database vs application server resource competition

**Key Insights for Teams**:
- **Database Teams**: Query performance optimization targets
- **Backend Teams**: Caching strategy effectiveness validation
- **SRE Teams**: Database scaling and failover scenario planning  
- **Architecture Teams**: Database design bottleneck identification

**What to watch for**:
- Stats operations completing under 1 second (good indexing)
- Complex JOINs under 2 seconds (efficient query design)
- Slow queries behaving predictably (proper timeout handling)
- No database connection leaks during sustained load

---

### **⚡ Performance Testing - Latency Simulation & Monitoring**

**What it simulates**: Variable external dependencies and network conditions  
**What you can observe**:

- **External Service Impact**: How slow dependencies affect overall system
- **Timeout Strategy Effectiveness**: Circuit breaker and retry logic behavior
- **User Experience Degradation**: How latency affects end-user experience
- **System Resilience**: Graceful degradation under poor conditions
- **Monitoring Accuracy**: How well your observability captures real issues

**Key Insights for Teams**:
- **Operations Teams**: Service dependency mapping and monitoring
- **DevOps Teams**: Circuit breaker tuning and configuration
- **Product Teams**: User experience impact assessment
- **QA Teams**: Non-functional requirement validation

**What to watch for**:
- Latency simulation accuracy within 100ms (monitoring precision)
- No cascading failures when dependencies slow down
- Proper timeout implementation (requests don't hang indefinitely)
- Clear correlation between dependency latency and user impact

---

### **💥 Error Simulation - Failure Recovery & Alerting**

**What it simulates**: System failures and error conditions  
**What you can observe**:

- **Error Detection Speed**: How quickly issues are identified
- **Alert Quality**: Signal vs noise in monitoring alerts
- **Recovery Time**: How fast the system returns to normal
- **Error Correlation**: Connecting errors to root causes
- **User Impact Assessment**: Real impact of errors on user experience

**Key Insights for Teams**:
- **SRE Teams**: Alert tuning and incident response validation
- **Development Teams**: Error handling effectiveness
- **Support Teams**: Error correlation and customer impact assessment
- **Business Teams**: Service reliability impact on business metrics

**What to watch for**:
- Alerts firing within 30 seconds of issues
- Clean error traces showing full context
- No error amplification (one error causing many)
- Clear distinction between different error types

---

### **⏱️ Timeout Scenarios - Timeout Handling & Circuit Breaker Testing**

**What it simulates**: Various timeout conditions with circuit breaker patterns and resilience testing  
**What you can observe**:

- **Timeout Detection Accuracy**: How well the system detects and handles different timeout types
- **Circuit Breaker Effectiveness**: Protection mechanisms under timeout stress
- **Service Context Impact**: How timeouts affect different service layers
- **Recovery Strategy Validation**: Different timeout recovery approaches
- **Custom Timeout Handling**: User-defined timeout thresholds behavior

**Key Insights for Teams**:
- **Backend Teams**: Timeout configuration and handling robustness
- **SRE Teams**: Circuit breaker tuning and failover mechanisms
- **DevOps Teams**: Service mesh timeout configuration
- **QA Teams**: Non-functional timeout requirement validation

**Timeout Types & Expected Behavior**:

1. **Client Timeout (5s threshold)**
   - **Success Rate**: ~20% (client gives up waiting)
   - **Circuit Breaker**: Opens after 5 failures
   - **Recovery**: Immediate retry strategy
   - **Use Case**: Frontend request timeouts

2. **Server Timeout (10s threshold)**
   - **Success Rate**: ~30% (server processing too slow)
   - **Circuit Breaker**: Opens after 3 failures
   - **Recovery**: Exponential backoff
   - **Use Case**: Backend processing timeouts

3. **Network Timeout (3s threshold)**
   - **Success Rate**: ~15% (network communication issues)
   - **Circuit Breaker**: Opens after 7 failures
   - **Recovery**: Circuit breaker with fallback
   - **Use Case**: Inter-service communication

4. **Gateway Timeout (15s threshold)**
   - **Success Rate**: ~10% (proxy/gateway issues)
   - **Circuit Breaker**: Opens after 2 failures
   - **Recovery**: Circuit breaker protection
   - **Use Case**: API gateway scenarios

5. **Read Timeout (2s threshold)**
   - **Success Rate**: ~25% (socket read issues)
   - **Circuit Breaker**: Opens after 4 failures
   - **Recovery**: Retry with jitter
   - **Use Case**: Data reception timeouts

6. **Connect Timeout (1s threshold)**
   - **Success Rate**: ~5% (connection establishment issues)
   - **Circuit Breaker**: Opens after 10 failures
   - **Recovery**: Exponential backoff with limit
   - **Use Case**: Initial connection timeouts

**What to watch for**:
- Timeout detection within configured thresholds
- Circuit breaker state transitions working correctly
- Independent circuit breakers per service context
- Proper error responses (408 for timeouts, 503 for circuit breaker open)
- Recovery suggestions matching configured strategies

**🔧 Technical Implementation Notes**:
- **TypeScript Compatibility**: All schema definitions are Fastify-compatible (no OpenAPI properties)
- **Circuit Breaker Isolation**: Independent state per timeout_type + service_context combination
- **Map Iteration Compatibility**: Uses `forEach` instead of `entries()` for ES5 compatibility
- **Custom Metrics**: 7 timeout-specific metrics for comprehensive monitoring

---

### **🔥 Database Error Scenarios - Error Recovery & Resilience Testing**

**What it simulates**: Database connection errors, network issues, and recovery mechanisms  
**What you can observe**:

- **Error Recovery Patterns**: How the system handles different database failure modes
- **Retry Logic Effectiveness**: Exponential backoff and retry strategy validation
- **Circuit Breaker Behavior**: System protection mechanisms under database stress
- **Error Correlation**: Tracing error propagation through the system
- **Recovery Time Measurement**: Time to recover from different error scenarios

**Key Insights for Teams**:
- **Database Teams**: Connection pool configuration and failure handling
- **Backend Teams**: Retry logic tuning and error handling robustness
- **SRE Teams**: Database failover and recovery time optimization
- **Infrastructure Teams**: Network resilience and timeout configuration

**Scenario Types & Expected Behavior**:

1. **Connection Timeout (25% of error tests)**
   - **Failure Rate**: ~90% (connection establishment issues)
   - **Max Time**: <10 seconds (including retries)
   - **Common Contexts**: User queries, background jobs
   - **What to watch**: Proper timeout handling, no hanging connections

2. **Connection Refused (20% of error tests)**
   - **Failure Rate**: ~95% (port closed/service down)
   - **Max Time**: <1 second (fast failure)
   - **Common Contexts**: User queries, health checks
   - **What to watch**: Fast failure detection, proper error messaging

3. **Database Deadlock (30% of error tests)**
   - **Failure Rate**: ~70% (transaction conflicts)
   - **Max Time**: <8 seconds (deadlock resolution)
   - **Common Contexts**: User queries, background jobs
   - **What to watch**: Deadlock detection speed, transaction rollback

4. **Connection Pool Exhaustion (15% of error tests)**
   - **Failure Rate**: ~80% (no available connections)
   - **Max Time**: <12 seconds (pool timeout)
   - **Common Contexts**: Background jobs, health checks
   - **What to watch**: Pool size configuration, connection leaks

5. **Network Partition (10% of error tests)**
   - **Failure Rate**: 100% (network completely unavailable)
   - **Max Time**: <20 seconds (network timeout)
   - **Common Contexts**: Migrations, background jobs
   - **What to watch**: Network timeout configuration, service degradation

**Error Recovery Features**:
- **Retry Logic**: Exponential backoff with jitter (configurable 0-5 attempts)
- **Operation Context**: Different retry strategies per operation type
- **Force Error**: Deterministic testing option (20% of tests)
- **Recovery Metrics**: Detailed timing and attempt tracking

**What to watch for**:
- **Success Rate**: Minimum 15% overall (some scenarios designed to fail)
- **Recovery Rate**: Minimum 20% of failed attempts should eventually succeed
- **Execution Time**: 95% of operations under 15 seconds total
- **Retry Attempts**: Average under 3 attempts per operation
- **Error Correlation**: Clear traces connecting errors to root causes
- **Recovery Time**: Fast recovery when possible (under 10 seconds)

---

### **⏱️ Timeout Scenarios - Circuit Breaker & Resilience Testing**

**What it simulates**: Various timeout conditions with circuit breaker patterns and resilience testing  
**What you can observe**:

- **Circuit Breaker Behavior**: Automatic service protection under timeout conditions
- **Timeout Handling**: Different timeout scenarios and recovery strategies
- **Service Resilience**: How systems behave under various timeout pressures
- **Recovery Patterns**: Circuit breaker state transitions and auto-recovery
- **Fallback Mechanisms**: Alternative responses when services are unavailable

**Key Insights for Teams**:
- **Backend Teams**: Timeout configuration and circuit breaker tuning
- **Platform Teams**: Service-to-service communication resilience
- **SRE Teams**: Service degradation patterns and recovery automation
- **Infrastructure Teams**: Network timeout optimization and failover behavior

**Timeout Scenarios & Expected Behavior**:

1. **Client Timeout (25% of timeout tests)**
   - **Timeout**: 5 seconds (client gives up waiting)
   - **Success Rate**: ~20% (80% timeout rate)
   - **Circuit Breaker**: Trips after 5 failures
   - **Recovery**: Immediate retry strategy

2. **Server Timeout (20% of timeout tests)**
   - **Timeout**: 10 seconds (server processing too slow)
   - **Success Rate**: ~30% (70% timeout rate)
   - **Circuit Breaker**: Trips after 3 failures
   - **Recovery**: Exponential backoff strategy

3. **Network Timeout (20% of timeout tests)**
   - **Timeout**: 3 seconds (network transmission failure)
   - **Success Rate**: ~15% (85% timeout rate)
   - **Circuit Breaker**: Trips after 7 failures
   - **Recovery**: Circuit breaker with fallback

4. **Gateway Timeout (15% of timeout tests)**
   - **Timeout**: 15 seconds (API gateway/proxy timeout)
   - **Success Rate**: ~10% (90% timeout rate)
   - **Circuit Breaker**: Trips after 2 failures
   - **Recovery**: Full circuit breaker protection

5. **Read Timeout (12% of timeout tests)**
   - **Timeout**: 2 seconds (socket read timeout)
   - **Success Rate**: ~25% (75% timeout rate)
   - **Circuit Breaker**: Trips after 4 failures
   - **Recovery**: Retry with jitter

6. **Connect Timeout (8% of timeout tests)**
   - **Timeout**: 1 second (connection establishment)
   - **Success Rate**: ~5% (95% timeout rate)
   - **Circuit Breaker**: Trips after 10 failures
   - **Recovery**: Exponential backoff with limit

**Circuit Breaker Features**:
- **States**: Closed (normal) → Open (failing) → Half-Open (testing)
- **Auto-Recovery**: 30-second timeout for circuit breaker reset attempts
- **Service Context**: Independent breakers per service (`external_api`, `database`, `cache`, `messaging`, `file_system`)
- **Observability**: Full metrics tracking state changes and recovery patterns

**Configuration Options**:
- **force_timeout**: Deterministic timeout testing (80% of tests)
- **custom_timeout_ms**: Override default timeout thresholds
- **service_context**: Target different service types for context-aware testing
- **enable_circuit_breaker**: Toggle circuit breaker protection

**What to watch for**:
- **Timeout Distribution**: Proper timeout handling across different scenarios
- **Circuit Breaker Activity**: Breaker opening/closing based on failure thresholds
- **Recovery Time**: Service recovery within 30-60 seconds of breaker reset
- **Service Isolation**: Independent circuit breaker behavior per service context
- **Fallback Response**: 503 Service Unavailable when circuit breaker is open
- **Response Codes**: 200 (success), 408 (timeout), 503 (circuit breaker open)

---

### **🧠 CPU Intensive Operations - Computational Performance Analysis**

**What it simulates**: CPU-intensive workloads and computational performance  
**What you can observe**:

- **CPU Performance Limits**: How algorithms scale under different intensities
- **Resource Competition**: CPU vs I/O bound operations impact
- **Algorithm Efficiency**: Performance comparison across computation types
- **Scalability Patterns**: How computational load affects response times
- **Custom Iterations Impact**: Performance with variable workload sizes

**Key Insights for Teams**:
- **Algorithm Teams**: Performance benchmarking and optimization targets
- **Backend Teams**: CPU resource planning and algorithm selection
- **SRE Teams**: CPU-based scaling and performance monitoring
- **Architecture Teams**: Computational bottleneck identification

**What to watch for**:
- Fibonacci calculations scaling predictably with intensity levels
- Prime calculations completing efficiently (optimized algorithms)
- Matrix operations showing expected O(n³) behavior
- Hash computations maintaining consistent performance
- Custom iterations parameter working correctly for all computation types

**Expected Performance Ranges**:
- **Low intensity**: < 50ms execution time
- **Medium intensity**: 50-500ms execution time  
- **High intensity**: 500-2000ms execution time
- **Extreme intensity**: 1-5 seconds execution time

**CPU Utilization Monitoring**:
- Track CPU usage correlation with computation complexity
- Monitor for CPU throttling under sustained load
- Validate that different computation types show distinct performance signatures
- Ensure proper resource cleanup after intensive operations

---

## 🔍 Cross-Scenario Analysis Opportunities

### **Load Progression Impact**
Compare metrics across different load stages:
- **Response time degradation**: How performance scales with users
- **Error rate increase**: When does the system start failing
- **Resource saturation**: CPU/memory thresholds identification
- **Database behavior**: Connection pooling effectiveness
- **CPU intensive scaling**: How computational load affects overall system performance

### **Operation Type Correlation**
Analyze how different operations interact:
- **Resource competition**: Database heavy vs normal operations vs CPU intensive
- **Error propagation**: How database errors affect other operations
- **Performance isolation**: Whether slow operations affect fast ones
- **Error recovery impact**: How database error recovery affects system performance
- **Retry logic efficiency**: Analysis of exponential backoff and recovery patterns
- **Caching effectiveness**: Hit rates across different operation types

### **Time-Based Patterns**
Identify temporal behavior:
- **Warm-up effects**: System performance improvement over time
- **Resource leaks**: Gradual performance degradation
- **Periodic issues**: Regular performance dips or spikes
- **Seasonal behavior**: Different patterns during different test phases

### **Platform Comparison Insights**
Use data to compare SignOz vs GCP:
- **Query performance**: How fast can you find specific issues
- **Correlation capabilities**: Connecting metrics, logs, and traces
- **Alert flexibility**: Custom alerting rule creation and tuning
- **Cost efficiency**: Resource usage vs feature set analysis

---

## 💡 Actionable Insights Framework

### **Green Scenarios (All Passing)**
- System is performing within expected parameters
- Current architecture scales appropriately
- Monitoring coverage is adequate
- Ready for production traffic increase

### **Yellow Scenarios (Some Thresholds Crossed)**  
- Performance degradation under specific conditions
- Monitoring gaps requiring attention
- Optimization opportunities identified
- Scaling preparation needed

### **Red Scenarios (Multiple Failures)**
- Critical performance issues requiring immediate attention
- Architecture limitations discovered
- Monitoring blind spots exposed
- Production readiness concerns

This framework helps teams move from **"What happened?"** to **"What should we do about it?"**

## 📝 Adding New Tests

1. **Create scenario file** in `scenarios/` directory
2. **Follow naming convention**: `scenario-name.js`
3. **Export options and default function**
4. **Use utilities** from `utils/` and `config/`
5. **Test locally** with quick runs
6. **Document** new scenario in this README

### **Example Scenario Template**
```javascript
import { currentEnv, getThresholds } from '../config/environments.js';

export const options = {
  stages: [
    { duration: '1m', target: 10 },
  ],
  thresholds: getThresholds(),
};

export default function () {
  // Your test logic here
}
```

## 🔍 Troubleshooting

### **Common Issues**
- **k6 not found**: Install with `brew install k6`
- **Server not running**: Start with `pnpm dev`
- **Permission denied**: Run `chmod +x run-tests.sh`
- **Test fails**: Check server logs and endpoint availability

### **Performance Issues**
- Reduce virtual users for lower-spec machines
- Use `quick` duration for fast iteration
- Check available memory and CPU during tests 

## 📊 Recent Improvements & Fixes

### ✅ Infrastructure Enhancements (Latest Updates)

- **Fixed endpoint URLs**: Corrected error simulation endpoint from `/v1/simulate-error/simulate-error` to `/v1/simulateError`
- **Database scaling**: Expanded from 2 to 100 seeded users for realistic load testing
- **Improved foreign key handling**: Reviews now use valid user_id (1-100) and book_id (1-10) ranges
- **Enhanced error handling**: Error simulation now returns proper JSON responses with 500 status codes
- **Comprehensive testing**: All scenarios (read, write, performance, error) now have 100% success rates

### 🔧 TypeScript & Schema Fixes (Step 2.2 Completion)

- **Fixed Fastify Schema Compatibility**: Removed OpenAPI-specific properties (`summary`, `description`, `tags`) from route schemas
- **Resolved Map Iteration Issues**: Changed `circuitBreakers.entries()` to `circuitBreakers.forEach()` for ES5 compatibility
- **TypeScript Build Success**: All compilation errors resolved, clean build achieved
- **Route Handler Types**: Proper generic types added for request body and response validation
- **Circuit Breaker Enhancement**: Improved error-safe iteration through circuit breaker states
- **Code Quality Improvements**: Template literals, proper exponential notation, cleaner conditionals

### 🎯 Test Results (Latest Run)

**Quick Test (1 minute):**
- ✅ **142 HTTP requests** processed
- ✅ **91 iterations** completed successfully  
- ✅ **375/375 checks passed** (100% success rate)
- ✅ **Slow endpoint accuracy**: p95 = 2.55ms (target < 50ms)
- ✅ **HTTP error rate**: 3.52% (target < 10%)
- ✅ **Custom success rate**: 2.23/s 