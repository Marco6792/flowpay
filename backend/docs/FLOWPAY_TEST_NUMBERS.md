# FlowPay Test Numbers

FlowPay provides merchant-friendly test numbers that automatically map to the appropriate provider test scenarios. This allows you to test different payment outcomes without needing to know the underlying provider details.

## 📋 Available Test Numbers

### ✅ Success Scenarios
| FlowPay Number | Expected Outcome | Description |
|-----------------|------------------|-------------|
| `237670000000@cameroon` | ✅ **IMMEDIATE SUCCESS** | Payment will succeed immediately |
| `237670000001@cameroon` | ✅ **IMMEDIATE SUCCESS** | Payment will succeed immediately (alternative) |

### ❌ Error Scenarios
| FlowPay Number | Expected Outcome | Description |
|-----------------|------------------|-------------|
| `237670000010@cameroon` | ❌ **FAILED** | Payment will fail |
| `237670000011@cameroon` | ❌ **REJECTED** | Payment will be rejected by provider |
| `237670000012@cameroon` | ⏰ **TIMEOUT** | Payment will timeout |
| `237670000013@cameroon` | ❌ **ERROR CONDITION** | Payment will trigger a general error |

### ⏰ Timing Scenarios
| FlowPay Number | Expected Outcome | Description |
|-----------------|------------------|-------------|
| `237670000020@cameroon` | ⏰ **DELAYED SUCCESS** | Payment will be pending initially, then succeed after ~30 seconds |

### 🔄 Refund Transaction Scenarios
| FlowPay Number | Expected Outcome | Description |
|-----------------|------------------|-------------|
| `237650000001@cameroon` | ❌ **REFUND NOT FOUND** | Refund transaction could not be found |
| `237650000002@cameroon` | ❌ **REFUND FAILED** | Refund transaction has failed |
| `237650000003@cameroon` | ❌ **REFUND REJECTED** | Refund transaction was rejected |
| `237650000004@cameroon` | ⏰ **REFUND EXPIRED** | Refund transaction has expired |
| `237650000005@cameroon` | ⏳ **REFUND ONGOING** | Refund transaction is still ongoing |
| `237650000006@cameroon` | ⏸️ **REFUND DELAYED** | Refund transaction has been delayed |
| `237650000007@cameroon` | 🚫 **REFUND NOT ALLOWED** | Refund transaction is not allowed |
| `237650000008@cameroon` | 🌍 **REFUND ENV ERROR** | Refund not allowed in target environment |
| `237650000009@cameroon` | 🔗 **REFUND CALLBACK ERROR** | Invalid callback URL host for refund |
| `237650000010@cameroon` | 💱 **REFUND CURRENCY ERROR** | Invalid currency for refund transaction |
| `237650000011@cameroon` | ⚙️ **REFUND PROCESSING ERROR** | Internal processing error during refund |
| `237650000012@cameroon` | 🔴 **REFUND SERVICE UNAVAILABLE** | Refund service is currently unavailable |
| `237650000013@cameroon` | 💥 **REFUND COULD NOT PERFORM** | Could not perform the refund transaction |

## 🔧 Usage Examples

### Successful Payment
```json
{
  "id": "your_unique_id_123",
  "from": "237670000000@cameroon",
  "to": "237680000000@cameroon",
  "amount": 10000,
  "timestamp": "2025-01-14T10:30:00.000Z"
}
```

### Failed Payment Test
```json
{
  "id": "fail_test_123",
  "from": "237670000010@cameroon",
  "to": "237680000000@cameroon",
  "amount": 5000,
  "timestamp": "2025-01-14T10:30:00.000Z"
}
```

### Delayed Success Test
```json
{
  "id": "delayed_test_123",
  "from": "237670000020@cameroon",
  "to": "237680000000@cameroon",
  "amount": 15000,
  "timestamp": "2025-01-14T10:30:00.000Z"
}
```

### Refund Transaction Test
```json
{
  "amount": 5000,
  "reason": "Customer requested refund"
}
```

### Failed Refund Test
```json
{
  "amount": 2500,
  "reason": "Testing refund failure scenario"
}
```

## 🌍 Environment Behavior

### Sandbox Environment
- FlowPay test numbers are **automatically mapped** to provider-specific test numbers
- Use **XAF** currency (FlowPay handles EUR conversion internally)
- No real money is charged
- No SMS/USSD prompts are sent

### Production Environment
- Test numbers are treated as **regular phone numbers**
- Real transactions will be attempted
- Use only for actual customer payments

## 🔄 Status Flow Examples

### Immediate Success (237670000000)
```
POST /payments → status: PENDING → (immediately) → status: COMPLETED
```

### Failed Payment (237670000010)
```
POST /payments → status: PENDING → (processing) → status: FAILED
```

### Delayed Success (237670000020)
```
POST /payments → status: PENDING → (30 seconds) → status: COMPLETED
```

### Timeout (237670000012)
```
POST /payments → status: PENDING → (processing) → status: FAILED (reason: timeout)
```

## 📖 Testing Best Practices

1. **Test All Scenarios**: Use different test numbers to verify your error handling
2. **Check Status Updates**: Poll payment status to see transitions
3. **Verify Webhooks**: Ensure webhook endpoints receive status updates
4. **Handle Delays**: Account for the 30-second delay in delayed success tests
5. **Log Everything**: Monitor logs to see the internal MTN number mapping

## 🔗 Provider Mapping

FlowPay test numbers internally map to provider test numbers:

| FlowPay Number | MTN Test Number | Scenario |
|----------------|-----------------|----------|
| 237670000000   | 46733999999     | Success |
| 237670000010   | 46733123450     | Failed |
| 237670000011   | 46733123451     | Rejected |
| 237670000012   | 46733123452     | Timeout |
| 237670000013   | 46733123453     | Error |
| 237670000020   | 46733123454     | Delayed Success |
| **Refund Scenarios** | | |
| 237650000001   | 46733999999     | Refund Not Found |
| 237650000002   | 46733123450     | Refund Failed |
| 237650000003   | 46733123451     | Refund Rejected |
| 237650000004   | 46733123452     | Refund Expired |
| 237650000005   | 46733123453     | Refund Ongoing |
| 237650000006   | 46733123454     | Refund Delayed |
| 237650000007   | 46733123457     | Refund Not Allowed |
| 237650000008   | 46733123458     | Refund Env Error |
| 237650000009   | 46733123459     | Refund Callback Error |
| 237650000010   | 46733123460     | Refund Currency Error |
| 237650000011   | 46733123461     | Refund Processing Error |
| 237650000012   | 46733123462     | Refund Service Unavailable |
| 237650000013   | 46733123463     | Refund Could Not Perform |

> **Note**: This mapping only occurs in sandbox environment. In production, these are treated as regular phone numbers.

## 🚫 Important Notes

- **Sandbox Only**: Test number mapping only works in sandbox environment
- **Currency**: Always use `XAF` currency - internal EUR conversion is handled automatically
- **Real Numbers**: Any number not in the test list will be treated as a real customer number
- **Status Polling**: Use payment status endpoints to check final results
- **Rate Limits**: Standard API rate limits apply to test transactions

## 🔍 Troubleshooting

### Test Not Working?
1. Verify you're using sandbox environment
2. Check that the phone number exactly matches the test numbers above
3. Use XAF currency, not EUR
4. Wait appropriate time for delayed success scenarios

### Getting Real Results?
If test numbers behave like real payments, check:
- Environment configuration (`MTN_TARGET_ENVIRONMENT=sandbox`)
- Number format (exactly as shown, no extra formatting)
- API endpoint (sandbox vs production URL)

## 📞 Support

For issues with test numbers or unexpected behavior:
1. Check API logs for number mapping information
2. Verify environment configuration
3. Review status polling intervals
4. Contact FlowPay support with transaction IDs

---

*Last Updated: 2025-01-14*
