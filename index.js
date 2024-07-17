// index.js

const express = require('express');
const app = express();
const PORT = process.env.PORT;
const { processURLs } = require('./sel');

app.get("/", (req, res) => {
    res.send("API running");
});

app.post('/api', (req, res) => {
    const urls = req.body.urls;
    processURLs(urls)
        .then(results => {
            console.log(JSON.stringify(results, null, 2));
            res.send(JSON.stringify(results, null, 2));
        })
        .catch(error => {
            console.error(`Error scraping websites: ${error.message}`);
            res.status(500).send(`Error scraping websites: ${error.message}`);
        });
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
