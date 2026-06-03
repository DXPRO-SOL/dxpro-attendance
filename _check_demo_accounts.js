process.env.MONGODB_URI = "mongodb+srv://dxprosol:kim650323@dxpro.ealx5.mongodb.net/attendance-system?retryWrites=true&w=majority";
const mongoose = require('./node_modules/mongoose');
mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const demoDbName = 'nokori-demo-6a2045f6a059283236d480fa';
  const db = mongoose.connection.useDb(demoDbName);
  const colls = await db.db.listCollections().toArray();
  for (const c of colls) {
    const count = await db.collection(c.name).countDocuments();
    if (count > 0) console.log(` ✅ ${c.name}: ${count} docs`);
  }
  await mongoose.disconnect();
});
