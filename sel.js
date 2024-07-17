const cheerio = require('cheerio');
const urlModule = require('url');
const { default: axios } = require('axios');
const googleIt = require('google-it');

async function fetchHTML(url) {
    try {
        const response = await axios.get(url, {
            headers: {
                'Accept': 'text/html,application/xhtml+xml',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
        return response.data;
    } catch (error) {
        console.error(`Error fetching HTML from ${url}: ${error.message}`);
        return null;
    }
}

function extractEmailAddresses(htmlContent, domain) {
    const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const emails = new Set();
    const $ = cheerio.load(htmlContent);
    const textContent = $('body').text().toLowerCase();

    let match;
    while ((match = emailPattern.exec(textContent)) !== null) {
        if (match[0].toLowerCase().endsWith(`@${domain}`)) {
            emails.add(match[0].toLowerCase());
        }
    }

    return Array.from(emails);
}

function extractPhoneNumbers(htmlContent) {
    const phonePattern = /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g;
    const phones = new Set();
    const $ = cheerio.load(htmlContent);
    const textContent = $('body').text();

    let match;
    while ((match = phonePattern.exec(textContent)) !== null) {
        phones.add(match[0]);
    }

    return Array.from(phones);
}

function extractDomainFromURL(websiteURL) {
    try {
        const parsedURL = new URL(websiteURL);
        let domain = parsedURL.hostname.toLowerCase();
        if (domain.startsWith('www.')) {
            domain = domain.slice(4); // Remove 'www.' prefix
        }
        return domain;
    } catch (error) {
        console.error(`Invalid URL format: ${websiteURL}`);
        return null;
    }
}

function extractLinks(htmlContent, baseURL, originalDomain) {
    const $ = cheerio.load(htmlContent);
    const links = [];
    const priorityPages = new Set(['contact', 'about', 'team', 'staff']);
    const skipExtensions = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.mp4', '.mov', '.avi', '.wmv']);

    $('a[href]').each((index, element) => {
        const href = $(element).attr('href');
        if (href) {
            const absoluteURL = urlModule.resolve(baseURL, href);
            const parsedURL = new URL(absoluteURL);
            const path = parsedURL.pathname.toLowerCase();
            const extension = path.slice(path.lastIndexOf('.'));

            if (!skipExtensions.has(extension) && parsedURL.hostname.endsWith(originalDomain)) {
                const normalizedPath = path.replace(/\/$/, ''); // Normalize path
                if (priorityPages.has(normalizedPath.split('/').pop())) {
                    links.unshift(absoluteURL); // Add priority pages to the beginning of the list
                } else {
                    links.push(absoluteURL);
                }
            }
        }
    });

    return links;
}

async function scrapeWebsite(url, companyName) {
    try {
        const MIN_EMAIL_COUNT = 50;
        let originalDomain = extractDomainFromURL(url);

        if (!originalDomain) {
            console.error(`Skipping ${url} - Invalid URL format`);
            return null;
        }

        // Function to check if URL should be skipped
        async function shouldSkipURL(url, companyName) {
            // Example dynamic condition based on parameters
            if (companyName && companyName.toLowerCase().includes('example')) {
                return true; // Skip if companyName includes 'example'
            }
            // Add more conditions as needed based on your requirements
            return false;
        }

        // If URL should be skipped, search for company name and get URL
        if (await shouldSkipURL(url, companyName)) {
            console.log(`Skipping ${url} - Searching for appropriate URL...`);

            if (companyName) {
                const searchResults = await googleIt({ query: `${companyName} official website` });
                if (searchResults && searchResults.length > 0) {
                    const foundURL = searchResults[0].link;
                    console.log(`Found URL: ${foundURL}`);
                    url = foundURL;
                    originalDomain = extractDomainFromURL(url); // Update original domain with new URL
                } else {
                    console.log(`Could not find an appropriate URL for ${companyName}`);
                    return null;
                }
            } else {
                console.log(`Company name not found for ${url}`);
                return null;
            }
        }

        const visitedURLs = new Set();
        const emails = new Set();
        const phones = new Set();
        let pagesVisited = 0;

        async function scrapePage(url) {
            if (visitedURLs.has(url)) {
                return;
            }

            visitedURLs.add(url);
            console.log(`Scraping ${url}...`);
            pagesVisited++;

            const htmlContent = await fetchHTML(url);

            if (!htmlContent) {
                console.log(`Skipping ${url} - No HTML content`);
                return;
            }

            const emailsFromPage = extractEmailAddresses(htmlContent, originalDomain);
            const phonesFromPage = extractPhoneNumbers(htmlContent);

            emailsFromPage.forEach(email => emails.add(email));
            phonesFromPage.forEach(phone => phones.add(phone));

            if (emails.size >= MIN_EMAIL_COUNT) {
                console.log(`Reached the desired number of ${MIN_EMAIL_COUNT} emails.`);
                return;
            }

            if (pagesVisited >= 100) {
                console.log(`Reached the limit of 500 pages.`);
                return;
            }

            const links = extractLinks(htmlContent, url, originalDomain);
            for (const link of links) {
                await scrapePage(link);
                if (emails.size >= MIN_EMAIL_COUNT || pagesVisited >= 100) {
                    break;
                }
            }
        }

        await scrapePage(url);

        return {
            domain: originalDomain,
            emails: Array.from(emails),
            phones: Array.from(phones)
        };
    } catch (error) {
        console.error(`Error scraping website ${url}: ${error.message}`);
        return null;
    }
}

async function processJSON(inputJSON) {
    const results = [];

    for (const record of inputJSON) {
        let websiteURL = record['website'];
        const companyName = record['companyName'];

        if (!websiteURL) {
            console.error(`Skipping record - Missing 'website' field`);
            continue;
        }

        // Normalize URL if needed
        if (!websiteURL.startsWith('http://') && !websiteURL.startsWith('https://')) {
            websiteURL = `http://${websiteURL}`;
        }

        // Try scraping the website
        let result = await scrapeWebsite(websiteURL, companyName);

        // Prepare the result object to include in output
        if (result) {
            record['domain'] = result.domain;
            record['emails'] = result.emails;
            record['phones'] = result.phones;
        } else {
            record['domain'] = '';
            record['emails'] = [];
            record['phones'] = [];
        }

        results.push(record);
    }

    return results;
}

module.exports={processJSON}