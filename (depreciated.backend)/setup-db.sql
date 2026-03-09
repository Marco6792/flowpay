-- Create user and database for FlowPay
CREATE USER flowpay WITH PASSWORD 'flowpay_password';
CREATE DATABASE flowpay OWNER flowpay;
GRANT ALL PRIVILEGES ON DATABASE flowpay TO flowpay;
-- Grant schema permissions
\c flowpay
GRANT ALL ON SCHEMA public TO flowpay;