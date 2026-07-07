import { googleSearchService } from '../src/services/googleSearchService.js';

const exceeded = await googleSearchService.checkDailyLimit();
console.log('Daily limit exceeded (expect false, limit=100, 0 used today):', exceeded);
