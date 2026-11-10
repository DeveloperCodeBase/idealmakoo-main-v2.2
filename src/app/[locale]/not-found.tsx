import {NotFoundContent,requestNotFoundLocale} from '@/server/not-found';

export default async function LocalNotFound(){
  return <NotFoundContent locale={await requestNotFoundLocale()}/>;
}
