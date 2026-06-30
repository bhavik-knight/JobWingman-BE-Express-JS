import nodemailer from 'nodemailer';

export const createDynamicTransporter = (emailUser: string, appPassword: string) => {
    const domain = emailUser.split('@')[1]?.toLowerCase() || '';
    
    // Setup standard default parameters for secure port 587 connection paths
    let smtpConfig: any = {
        host: '',
        port: 587,
        secure: false, // use false for STARTTLS over port 587
        auth: {
            user: emailUser,
            pass: appPassword
        },
        tls: {
            rejectUnauthorized: false // Bypasses local self-signed certificate constraints
        }
    };

    // Parse domain paths automatically to apply correct server configurations
    if (domain.includes('gmail.com')) {
        smtpConfig.host = 'smtp.gmail.com';
    } else if (
        domain.includes('outlook.com') || 
        domain.includes('hotmail.com') || 
        domain.includes('live.com') || 
        domain.includes('smu.ca')
    ) {
        smtpConfig.host = 'smtp.office365.com';
        // Microsoft servers require specific cipher properties over TLS
        smtpConfig.tls = { ...smtpConfig.tls, ciphers: 'SSLv3' };
    } else {
        // Fallback to Office365 relay as a default catch-all strategy
        smtpConfig.host = 'smtp.office365.com';
    }

    return nodemailer.createTransport(smtpConfig);
};
