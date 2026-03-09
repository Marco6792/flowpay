# MTN MoMo Sandbox Test Numbers

## Important: Test MSISDN Numbers for Sandbox

In the MTN MoMo Sandbox environment, specific test numbers yield different response statuses. Use these numbers for testing different scenarios:

| Test Number (MSISDN) | Expected Status Response | Use Case |
|---------------------|-------------------------|----------|
| `46733123450` | **Failed** | Test payment failures |
| `46733123451` | **Rejected** | Test payment rejections |
| `46733123452` | **Timeout** | Test timeout scenarios |
| `56733123453` | **Success** | Test successful payments |
| `46733123454` | **Pending** | Test pending payments |

## Currency Requirements

- **Sandbox**: Must use `EUR` currency
- **Production**: Use country-specific currency (e.g., `XAF` for Cameroon)

## Phone Number Format

### For Testing (Sandbox)
- Use the test MSISDNs exactly as shown above
- Do NOT add country codes or modify the numbers

### For Production
- Numbers must begin with the country code
- Format: `237XXXXXXXXX` for Cameroon
- Example: `237670000000`

## Example Test Payments

### Successful Payment Test
```json
{
  "id": "test_success_001",
  "from": "56733123453",
  "to": "merchant_wallet",
  "amount": 1000,
  "timestamp": 1733145600000
}
```

### Failed Payment Test
```json
{
  "id": "test_fail_001",
  "from": "46733123450",
  "to": "merchant_wallet",
  "amount": 1000,
  "timestamp": 1733145600000
}
```

## Notes

1. These test numbers only work in the sandbox environment
2. The numbers don't need to be formatted with country codes in sandbox
3. Always use EUR currency in sandbox
4. Test different scenarios to ensure your error handling works correctly