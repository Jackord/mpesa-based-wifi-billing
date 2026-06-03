require("dotenv").config();
const axios = require("axios");
const moment = require("moment");

const MPESA_ENV = process.env.MPESA_ENV || "sandbox"; // "sandbox" or "production"
const MPESA_BASE_URL = MPESA_ENV === "sandbox" ? "https://sandbox.safaricom.co.ke" : "https://api.safaricom.co.ke";

// ✅ Ensure required env variables are set
const REQUIRED_ENV_VARS = [
    "MPESA_CONSUMER_KEY",
    "MPESA_CONSUMER_SECRET",
    "MPESA_SHORTCODE",
    "MPESA_PASSKEY",
    "MPESA_CALLBACK_URL"
];

for (const varName of REQUIRED_ENV_VARS) {
    if (!process.env[varName]) {
        console.error(`❌ Missing environment variable: ${varName}`);
        process.exit(1); 
    }
}

// ✅ Get access token
const getAccessToken = async () => {
    const auth = Buffer.from(`${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`).toString("base64");

    try {
        const response = await axios.get(`${MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
            headers: { Authorization: `Basic ${auth}` }
        });
        console.log("✅ MPesa Access Token Obtained Successfully");
        return response.data.access_token;
    } catch (error) {
        console.error("❌ MPesa Auth Error:", error.response ? error.response.data : error.message);
        return null;
    }
};

// ✅ STK Push
const stkPush = async (phone, amount, transactionId) => {
    console.log(`📩 STK Push Request: Phone: ${phone}, Amount: ${amount}, TransactionID: ${transactionId}`);

    const accessToken = await getAccessToken();
    if (!accessToken) {
        console.error("❌ Failed to get MPesa access token. STK Push aborted.");
        return null;
    }

    const timestamp = moment().format("YYYYMMDDHHmmss");
    
    // 🔑 PASSWORD ENCRYPTION: Must use the app-linked Store Number (9201788) in production
    const cryptoShortcode = MPESA_ENV === "production" ? "9201788" : process.env.MPESA_SHORTCODE;
    
    // Generate base64 password
    const password = Buffer.from(`${cryptoShortcode}${process.env.MPESA_PASSKEY.trim()}${timestamp}`).toString("base64");

    // 🔄 TRANSACTION TYPE: Buy Goods layout for live till environments
    const transactionType = MPESA_ENV === "production" ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline";
    
    // 🏢 BUSINESS SHORTCODE: Must pass the Head Office code (4054193) in production
    const businessShortCode = MPESA_ENV === "production" ? "4054193" : process.env.MPESA_SHORTCODE;

    // 🏪 PARTY B: Must pass the targeted Public Till Number (9218852) in production
    const partyB = MPESA_ENV === "production" ? "9218852" : process.env.MPESA_SHORTCODE;

    const payload = {
        BusinessShortCode: businessShortCode, 
        Password: password,                   
        Timestamp: timestamp,
        TransactionType: transactionType,      
        Amount: amount,
        PartyA: phone,
        PartyB: partyB,                       
        PhoneNumber: phone,
        CallBackURL: process.env.MPESA_CALLBACK_URL,
        AccountReference: "WiFi Payment",
        TransactionDesc: `WiFi Payment - ${transactionId}`
    };

    try {
        console.log(`📤 Sending STK Push via type [${transactionType}] using Shortcode [${businessShortCode}]...`);
        
        const response = await axios.post(`${MPESA_BASE_URL}/mpesa/stkpush/v1/processrequest`, payload, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        if (response.data.ResponseCode === "0") {
            console.log("✅ STK Push Successful:", response.data);
            return response.data;
        } else {
            console.error("❌ STK Push Failed:", response.data);
            return null;
        }
    } catch (error) {
        console.error("❌ MPesa STK Push Error:", error.response ? error.response.data : error.message);
        return null;
    }
};

module.exports = { stkPush };
