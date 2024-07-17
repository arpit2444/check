import cheerio from 'cheerio';
import axios from 'axios';
import { URL } from 'url';
import pLimit from 'p-limit';

const limit = pLimit(5); // Limit to 5 concurrent requests

async function fetchHTML(url, retries = 2) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const response = await axios.get(url, {
                headers: {
                    'Accept': 'text/html,application/xhtml+xml',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });
            return response.data;
        } catch (error) {
            console.error(`Error fetching HTML from ${url} (attempt ${attempt}): ${error.message}`);
            if (attempt < retries) await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    return null;
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

function extractLinks(htmlContent, baseURL, originalDomain) {
    const $ = cheerio.load(htmlContent);
    const links = [];
    const priorityPages = new Set(['contact', 'about', 'team', 'staff']);
    const skipExtensions = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.mp4', '.mov', '.avi', '.wmv']);

    $('a[href]').each((index, element) => {
        const href = $(element).attr('href');
        if (href) {
            const absoluteURL = new URL(href, baseURL).href;
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

async function scrapeWebsite(url, pageNumber, originalDomain) {
    try {
        const MIN_EMAIL_COUNT = 1;

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

            if (pagesVisited >= pageNumber) {
                console.log(`Reached the limit of ${pageNumber} pages.`);
                return;
            }

            const links = extractLinks(htmlContent, url, originalDomain);
            for (const link of links) {
                await scrapePage(link);
                if (emails.size >= MIN_EMAIL_COUNT || pagesVisited >= pageNumber) {
                    break;
                }
            }
        }

        await scrapePage(url);

        return {
            emails: Array.from(emails),
            phones: Array.from(phones)
        };
    } catch (error) {
        console.error(`Error scraping website ${url}: ${error.message}`);
        return null;
    }
}

async function scrapeWebsites(urls, pageNumber) {
    const results = [];
    const tasks = urls.map(url => limit(async () => {
        console.log(`Processing ${url}...`);
        try {
            const fullUrl = url.startsWith("http") ? url : `http://${url}`;
            const hostname = new URL(fullUrl).hostname;
            console.log(`Extracted hostname: ${hostname}`);

            const result = await scrapeWebsite(fullUrl, pageNumber, hostname);

            if (result) {
                results.push({
                    url,
                    data: result
                });
            } else {
                results.push({
                    url,
                    error: 'Failed to scrape'
                });
            }
        } catch (error) {
            console.error(`Error processing URL ${url}: ${error.message}`);
            results.push({
                url,
                error: error.message
            });
        }
    }));

    await Promise.all(tasks);

    return results;
}

export { scrapeWebsites };
