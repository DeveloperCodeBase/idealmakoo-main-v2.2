import {resetDisposableAuthBudget} from './helpers/auth-budget';

export default async function acceptanceSetup(){
 if(process.env.PLAYWRIGHT_DISPOSABLE_AUTH_BUDGET==='true')console.log(JSON.stringify({event:'acceptance-auth-budget-start',...await resetDisposableAuthBudget()}));
}
