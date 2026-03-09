# MTN MoMo API Sandbox Limitations

## Known Issues

### 1. Refund API (disbursement/v1_0/refund)

**Status**: ❌ **BROKEN IN SANDBOX**

**Issue**: The refund endpoint consistently returns `400 Bad Request` with empty response body in sandbox environment.

**Affected Endpoints**:
- `/disbursement/v1_0/refund`
- `/disbursement/v2_0/refund`

**Error Response**:
```
HTTP/1.1 400 Bad Request
content-length: 0
```

**Community Reports**:
- Multiple developers experiencing same issue
- Reported on MTN MoMo Developer Community forums
- No working solution found as of August 2025
- Reference: https://momodevelopercommunity.mtn.com/momo-api-sand-box-q-a-6/sandbox-gives-me-400-bad-request-on-refund-307

**Our Implementation**:
- Code follows MTN API specification exactly
- All required headers and parameters are correct
- Successfully retrieves original payment details
- Gets valid disbursement access token
- Fails only at the refund request itself

**Production Status**: 
- Should work in production environment
- Cannot be tested in sandbox

**Workaround for Testing**:
- Set environment variable `MOCK_MTN_SANDBOX_REFUNDS=true` to mock refunds in development
- Or test refund flow with production credentials (with small amounts)

### 2. Webhook Callbacks

**Status**: ⚠️ **LIMITED IN SANDBOX**

**Issue**: Callbacks don't work in sandbox as there's no physical device input.

**Workaround**: Use status polling or the test webhook endpoints.

## Working Features in Sandbox

### ✅ Collection API
- Request to Pay
- Check Payment Status
- Get Account Balance

### ✅ Disbursement API  
- Transfer (Send Money)
- Check Transfer Status
- Get Account Balance
- **Note**: Refund endpoint is broken

### ✅ Authentication
- Same API user works for both Collection and Disbursement
- No need for separate credentials in sandbox

## Important Notes

1. **Currency**: Always use `EUR` for sandbox transactions
2. **Phone Numbers**: Use test MSISDNs provided by MTN
3. **API Users**: Single API user can access all products in sandbox
4. **Refunds**: Will only work in production environment

## Contact

For updates on sandbox issues:
- MTN MoMo Developer Community: https://momodevelopercommunity.mtn.com
- Official Documentation: https://momodeveloper.mtn.com