# FlowPay Deposit and Transfer Test Scenarios

## Summary
Based on user requirements, updating MTN provider test number mappings to support comprehensive Deposit and Transfer scenarios.

## New Deposit Test Scenarios (237680000XXX)
Using pattern 237680000450-237680000463 mapping to MTN numbers 46733123450-46733123463

```
DepositPayerFailed                     → 237680000450 → 46733123450
DepositPayerRejected                   → 237680000451 → 46733123451
DepositPayerExpired                    → 237680000452 → 46733123452
DepositPayerOngoing                    → 237680000453 → 46733123453
DepositPayerDelayed                    → 237680000454 → 46733123454
DepositPayerNotFound                   → 237680000455 → 46733123455
DepositPayerPayeeNotAllowedToReceive   → 237680000456 → 46733123456
DepositPayerNotAllowed                 → 237680000457 → 46733123457
DepositPayerNotAllowedTargetEnvironment → 237680000458 → 46733123458
DepositPayerInvalidCallbackUrlHost     → 237680000459 → 46733123459
DepositPayerInvalidCurrency            → 237680000460 → 46733123460
DepositPayerInternalProcessingError    → 237680000461 → 46733123461
DepositPayerServiceUnavailable         → 237680000462 → 46733123462
DepositPayerCouldNotPerformTransaction → 237680000463 → 46733123463
```

## New Transfer Test Scenarios (237690000XXX)
Using pattern 237690000450-237690000463 mapping to MTN numbers 46733123450-46733123463

```
TransferPayeeFailed                     → 237690000450 → 46733123450
TransferPayeeRejected                   → 237690000451 → 46733123451
TransferPayeeExpired                    → 237690000452 → 46733123452
TransferPayeeOngoing                    → 237690000453 → 46733123453
TransferPayeeDelayed                    → 237690000454 → 46733123454
TransferPayeeNotEnoughFunds             → 237690000455 → 46733123455
TransferPayeePayerLimitReached          → 237690000456 → 46733123456
TransferPayeeNotFound                   → 237690000457 → 46733123457
TransferPayeeNotAllowed                 → 237690000458 → 46733123458
TransferPayeeNotAllowedTargetEnvironment → 237690000459 → 46733123459
TransferPayeeInvalidCallbackUrlHost     → 237690000460 → 46733123460
TransferPayeeInvalidCurrency            → 237690000461 → 46733123461
TransferPayeeInternalProcessingError    → 237690000462 → 46733123462
TransferPayeeServiceUnavailable         → 237690000463 → 46733123463
```

## Implementation Plan
1. Update FLOWPAY_TEST_NUMBER_MAPPING with new scenarios
2. Update scenario descriptions
3. Update handleTestScenario switch statement
4. Update Postman collection with new test requests
5. Test all scenarios