import{products,articles,resources,companyPages}from '@/data/catalog';
export const adminSections=[
 '', 'content','pages','page-builder/new','page-builder/home','products','research','knowledge','glossary','news','events','resources','reviews','translations','publications','media','forms','menus','hr','ai','ai/text','ai/image','ai/video','ai/audio','communications','staff','users','roles','migration','Migration','settings','profile','preferences',
 'crm','crm/overview','crm/accounts','crm/contacts','crm/leads','crm/opportunities','crm/pipeline','crm/activities','crm/quotes','crm/pricebooks','crm/samples','crm/handoffs','crm/deliveries','crm/partners','crm/cases','crm/tickets','crm/segments','crm/campaigns','crm/inbox','crm/automations','crm/customer-success','crm/success','crm/data','crm/reports','crm/rfqs','tickets',
 'monitoring','monitoring/overview','monitoring/availability','monitoring/performance','monitoring/business','monitoring/content','monitoring/security','monitoring/jobs','monitoring/notifications','monitoring/ai','monitoring/storage','monitoring/infrastructure','monitoring/recovery',
 'cms','cms/resources','cms/pages','cms/products','cms/research','cms/news','cms/events','cms/menus','cms/forms','media/library','media/collections','locales/translations','locales/releases','locales/reviews'
];
export const publicPaths=[
 '', 'products','products/detail','products/category/teeth','products/category/materials','compare','inquiry-list','technical-selection','sample-request',
 'resources','resources/ideal-makoo-mould-poster','resources/ideal-makoo-mould-guide','resources/official-site-archive','research','news','news/detail','blog','blog/detail','events','events/detail','careers','careers/detail','careers/apply','videos','videos/detail','media','media/detail','press-kit','press-kit/detail',
 'about','manufacturing','quality','sustainability','global','distributors','contact','support','faq','knowledge','glossary','cooperation','cooperation/distribution','cooperation/suppliers','cooperation/outsourcing','cooperation/investment','cooperation/research','factory-visit','quality-report','verify-product','privacy','terms','published','page','install',
 'tools/shade-mould-matcher','tools/clinical-protocol','for/dentist','for/lab','for/dealer','for/research',
 'auth/login','auth/register','auth/recover','auth/reset','auth/mfa','account','account/profile','account/preferences','account/settings','account/organizations','account/requests','account/requests/detail','account/quick-matrix','account/saved','account/notifications','account/notifications/devices','account/security','account/bookings','account/data-rooms','account/tenders',
 ...products.map(p=>'products/'+p.slug),...articles.map(a=>'research/'+a.slug),...resources.map(r=>'resources/'+r.slug),...companyPages.map(p=>p.slug),...adminSections.map(s=>'admin'+(s?'/'+s:''))
];
export const sitePaths=[...new Set(publicPaths)];
export const publicIndexablePaths=sitePaths.filter(path=>!['admin','account','auth','page','published'].some(prefix=>path===prefix||path.startsWith(prefix+'/'))&&!path.endsWith('/detail'));
