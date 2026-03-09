const FLOWPAY_TEST_NUMBER_MAPPING = {
  // FlowPay Deposit Test Scenarios (237680000XXX)
  '237680000451@cameroon': { mtnNumber: '46733123451', scenario: 'DEPOSIT_PREAPPROVAL_PAYEE_DECLINED' },
  '237680000451': { mtnNumber: '46733123451', scenario: 'DEPOSIT_PREAPPROVAL_PAYEE_DECLINED' },
};

function formatPhoneNumber(phone) {
  console.log('Input phone:', phone);
  
  // Check if this is a FlowPay test number that should be mapped
  const mapping = FLOWPAY_TEST_NUMBER_MAPPING[phone];
  if (mapping) {
    console.log('Found mapping:', mapping);
    return mapping.mtnNumber;
  } else {
    console.log('No mapping found for:', phone);
  }
  
  return phone;
}

// Test cases
console.log('=== Testing phone number mapping ===');
formatPhoneNumber('237680000451@cameroon');
formatPhoneNumber('237680000451');