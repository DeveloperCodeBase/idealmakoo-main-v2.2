import { handleRequest } from '../../../../server/router';
import {withApiSecurityHeaders} from '../../../../lib/api-security-headers';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=180;
type Context={params:Promise<{path:string[]}>};
async function route(request:Request,context:Context){return withApiSecurityHeaders(await handleRequest(request,(await context.params).path));}
export {route as GET,route as HEAD,route as POST,route as PUT,route as PATCH,route as DELETE};

