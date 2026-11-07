import 'dotenv/config';
import express from 'express';
import {MongoClient, ObjectId} from 'mongodb';
import cors from 'cors';


const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const client = new MongoClient(process.env.MONGODB_URI);
export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}

const mongoclienct = await connectToMongoDB();
const db = mongoclienct.db('event-management');
const eventsCollection = db.collection('events');

app.post('/create-event', async(req, res)=>{
  const data = req.body;
  const result = await eventsCollection.insertOne(data);
  // console.log(result);
  res.send(result);
})
app.get('/events', async(req, res)=>{
  const result = await eventsCollection.find({}).toArray();
  res.send(result);
})

app.get(['/events/:id'], async(req, res)=>{
  const {id} = req.params;
  const result = await eventsCollection.findOne({_id:new ObjectId(id)});
  console.log({id});
  res.send(result);

})

app.get('/', (req, res) => {
  res.send('Hello World');
});


app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});