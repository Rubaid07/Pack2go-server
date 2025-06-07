const express = require('express');
const cors = require('cors')
const app = express();
const port = process.env.PORT || 3000;

app.use(cors()) ;
app.use(express.json())

app.get('/', (req, res) => {
    res.send('Pack2Go is cooking')
})
app.listen(port, ()=> {
    console.log(`Pack2Go server is running on port ${port}`);
})