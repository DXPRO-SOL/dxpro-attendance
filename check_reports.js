require('./config/db');
const { DailyReport } = require('./models');
setTimeout(async () => {
    await new Promise(r => setTimeout(r, 3000));
    const reports = await DailyReport.find({}).sort({ createdAt: -1 }).limit(5).lean();
    reports.forEach(r => {
        console.log('=== reportDate:', r.reportDate, '===');
        console.log('attachments count:', (r.attachments || []).length);
        console.log('attachments:', JSON.stringify(r.attachments, null, 2));
    });
    process.exit(0);
}, 500);
