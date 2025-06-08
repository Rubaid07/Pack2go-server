const express = require('express');
const cors = require('cors')
const app = express();
const port = process.env.PORT || 3000;
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();

app.use(cors());
app.use(express.json())


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ynxyt70.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;


const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    const db = client.db("pack2goDB");
    const packageCollection = db.collection("tourPackages");

    app.post('/packages', async (req, res) => {
      const newPackage = req.body;
      const result = await packageCollection.insertOne(newPackage);
      res.send(result);
    });

    app.get('/packages', async (req, res) => {
      const packages = await packageCollection.find().toArray();
      res.send(packages);
    });

    app.get('/packages/featured', async (req, res) => {
      const featured = await packageCollection.find().sort({ created_at: -1 }).limit(6).toArray();
      res.send(featured);
    });

    app.get('/packages/:id', async (req, res) => {
      const id = req.params.id;
      const result = await packageCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    app.post('/bookings', async (req, res) => {
      const booking = req.body;
      const result = await db.collection('bookings').insertOne(booking);

      await db.collection('tourPackages').updateOne(
        { _id: new ObjectId(booking.tour_id) },
        { $inc: { bookingCount: 1 } }
      );
      res.send(result);
    });

  } finally {

  }
}
run().catch(console.dir);


app.get('/', (req, res) => {
  res.send('Pack2Go is cooking')
})
app.listen(port, () => {
  console.log(`Pack2Go server is running on port ${port}`);
})