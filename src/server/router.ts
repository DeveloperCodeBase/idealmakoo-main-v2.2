import {customerOtpStatus,requestCustomerOtp,verifyCustomerOtp} from './customer-otp';
import {getEngagement,recordContentView,createContentComment,setContentLike,createContentReport,listContentModeration,moderateContent,contentAnalytics} from './engagement';
import {getProviderUsage} from './provider-usage';
import {staffAssistanceCapabilities,generateStaffAssistance} from './ai-assistance';
import {searchPublicContent} from './public-discovery';
import {applicationVersion,releaseVersion} from './release';
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */



import { randomUUID } from "node:crypto";
import { json, csrf, rateLimit, visitorKey, readJson, expectedVersion, failure } from "./http";
import { query } from "./db";
import {listPublicCompanyCertificates,listManagedCompanyCertificates,listCompanyCertificateSources,createCompanyCertificate,updateCompanyCertificate,reviewCompanyCertificate,publishCompanyCertificate,withdrawCompanyCertificate,revokeCompanyCertificate,setCompanyCertificateState} from "./company-certificates";
import { assertPrivacyReady, listPrivacyRequests, createPrivacyRequest, getPrivacyRequest, decidePrivacyRequest, exportPrivacyRequest, executePrivacyErasure, listPrivacyHolds, createPrivacyHold, updatePrivacyHold } from "./privacy";
import { contentPreviewResponse, contentLeaseTokens, getContentLease, acquireContentLease, renewContentLease, listContentPreviews, createContentPreview, revokeContentPreview } from "./content-collaboration";
import { wishlistShareResponse, listWishlists, createWishlist, wishlistCatalog, getWishlist, updateWishlist, deleteWishlist, transferWishlistItems, previewWishlistShare, listWishlistShares, createWishlistShare, revokeWishlistShare } from "./wishlists";
import { crmSurveyResponse, listCrmTimeline, createCrmTimelineEntry, updateCrmTimelineEntry, listCrmTasks, createCrmTask, getCrmTask, updateCrmTask, setCrmTaskOccurrence, getCrmForecast, listCrmReportSnapshots, createCrmReportSnapshot, getCrmReportSnapshot, listCrmSuccessPlans, createCrmSuccessPlan, updateCrmSuccessPlan, listCrmSurveys, createCrmSurvey, revokeCrmSurvey } from "./crm-operations";
import { contactPreferencesResponse, contactUnsubscribeResponse, requestContactPreferences } from "./contact-notifications";
import { openrouterWebhook, aiStatus, generateAi, getAiJobs, createAiJob, cancelAiJob } from "./ai";
import { receiveCrmConnectorEvent, listCrmConnectors, createCrmConnector, updateCrmConnector, rotateCrmConnectorSecret, listCrmInbox, getCrmInboxItem, archiveCrmInboxItem, associateCrmInboxItem } from "./crm-inbox";
import { unsubscribeResponse, getNotificationPreferences, patchNotificationPreferences } from "./notification-policy";
import { communicationVerificationResponse, telegramVerificationWebhook, communicationPreferenceChannelsResponse, updateCommunicationChannel, revokeCommunicationChannel, getCommunicationChannels, connectCommunicationChannel, getContactChannels, requestContactChannel } from "./communication-channels";
import { sessionFor, sessionResponse, login, register, verifyMfa, logout, forgotPassword, resetPassword, requireActor, enrollMfa, confirmMfa, disableMfa, regenerateRecoveryCodes, changePassword, requestEmailVerification, confirmEmailVerification, requestPhoneVerification, confirmPhoneVerification, revokeSession, security } from "./auth";
import { browserMeasurementConfig, recordBrowserMeasurement, recordOperationalRequest } from "./operations-telemetry";
import { confirmCrmContactEndpoint, requestCrmEndpointVerification } from "./workspace-domain-endpoints";
import { getPublicSite, getWorkspace, saveWorkspace, publishWorkspace, assignWorkspaceRecord, unpublishWorkspace, getWorkspaceRevisions, restoreWorkspaceRevision, reviewWorkspaceContent, scheduleWorkspaceContent, cancelWorkspaceSchedule, listWorkspaceSchedules, getSitePreferences, saveSitePreferences } from "./workspace";
import { listPublicTenders, getPublicTender, listOwnTenderBids, submitTenderBid, getTenderBid, replaceTenderBid, withdrawTenderBid, listManagedTenders, createTender, getManagedTender, updateTender, reviewTender, changeTenderState, getTenderReviewers, setTenderReviewers, listTenderBids, reviewTenderTechnical, openTenderFinance } from "./tenders";
import { listPublicRepresentatives, getPublicRepresentative, createRepresentativeCorrection, getPartnerPublicProfile, savePartnerPublicProfile, commandPartnerPublicProfile, partnerProfileHistory } from "./partner-directory";
import { listResources, resourceBundle, getResource, resourceContent, listDataRooms, createResource, updateResource, addResourceVersion, reviewResourceVersion, publishResource, createDataRoom, updateDataRoom, listAccessGrants, searchAccessGrantSubjects, createAccessGrant, revokeAccessGrant } from "./resources";
import { listEventSessions, eventCalendar, listOwnBookings, createEventSession, updateEventSession, listEventAttendees } from "./events";
import { assert, HttpError } from "./types";
import { listRequests, guestHash, createRequest, getRequest, patchRequest, issueQuote } from "./requests";
import { quotePdf } from "./quote-pdf";
import { upload, assetResponse, listOwnAttachments, tenderEnvelopeResponse, crmEvidenceResponse, listMedia, deleteMedia } from "./media";
import { getSettings, patchSettings, getCollection, patchCollection, getPortal, patchPortal, notifications, readNotification, listUsers, getManagedUser, createUser, updateUser, resetManagedUserPassword, resetManagedUserMfa } from "./account";
import { storageUsage } from "./storage";
import {publicUploadPolicy,getManagedStoragePolicy,saveManagedStoragePolicy} from './storage-policy';
import { mergeGuestInquiries } from "./inquiry-collection";
import { listManagedPortalOrganizations, getManagedPortalOrganization, listPortalCrmAccountCandidates, linkPortalOrganizationAccount, getPortalOrganizationLinkHistory, getOrganizations, createOrganization, acceptOrganizationInvitation, updateOrganization, deleteOrganization, inviteOrganizationMember, revokeOrganizationMember, shareOrganizationRequest } from "./organizations";
import { searchCrmCampaignRecipients, listCrmSegments, createCrmSegment, getCrmSegment, updateCrmSegment, previewCrmSegment, snapshotCrmSegment, listCrmCampaigns, createCrmCampaign, getCrmCampaign, updateCrmCampaign, scheduleCrmCampaign, cancelCrmCampaign, listCrmSuppressions, createCrmSuppression, revokeCrmSuppression } from "./crm-campaigns";
import { listStaffInvitations, createStaffInvitation, acceptStaffInvitation, revokeStaffInvitation, previewStaffHandover, offboardStaff } from "./staff-lifecycle";
import { listSharedBlocks, createSharedBlock, detachSharedBlock, getSharedBlock, updateSharedBlock, getSharedBlockHistory, createSharedBlockRevision, getSharedBlockImpact, attachSharedBlock, applySharedBlockRevision, getSharedBlockRevision } from "./shared-blocks";
import { getCrmScopeDirectory, listCrmGroups, createCrmGroup, updateCrmGroup, setCrmGroupMember } from "./workspace-scopes";
import { listCrmTransfers, createCrmImport, createCrmExport, getCrmTransfer, listCrmTransferRows, commandCrmTransfer, downloadCrmTransfer, updateCrmTransferRow, searchCrmRecords } from "./crm-transfers";
import { listCrmRequests } from "./crm-request-selector";
import { getCrmDomain, saveCrmDomain } from "./workspace-domain-core";
import { convertCrmLead, transitionCrmSample, transitionCrmHandoff } from "./workspace-domain-operations";
import { listCrmPipelines, createCrmPipeline, saveCrmPipelineDraft, approveCrmPipeline } from "./workspace-pipelines";
import { getCrmRoutingConfiguration, getCrmRequestRouting, createCrmCalendar, updateCrmCalendar, createCrmRoutingRule, updateCrmRoutingRule } from "./workspace-routing";
import { listPricebookVersions, getCommercialPolicy, saveCommercialPolicy } from "./workspace-commercial";
import { listMediaProcessing, createMediaProcessing, getMediaProcessing, commandMediaProcessing } from "./media-processing";
import { getDamAsset, updateDamPolicy, createImageDerivative } from "./dam";
import { getKnowledgeIndex, enqueueKnowledgeIndex, cancelKnowledgeJob, removeKnowledgeSource } from "./knowledge";
import { monitoring } from "./monitoring";
import { listOperationalIncidents, createOperationalIncident, getOperationalIncident, transitionOperationalIncident } from "./operations-incidents";
import { listOperationalSlos, createOperationalSlo, updateOperationalSlo } from "./operations-slo";
import { enqueueNotification } from "./notifications";
import {listWorkspaceForms,getWorkspaceForm,saveWorkspaceForm,changeWorkspaceFormLifecycle,getFormRevisions,restoreWorkspaceFormRevision,getEditorRevisionDetail,getTranslationStatus,acknowledgeTranslation} from './editor-workflows';
import {proposeContentTranslation,applyContentTranslation} from './content-ai';
import {listProductRegistry,createProductRegistry,updateProductRegistry,changeProductRegistryState,lookupProductRegistry} from './product-registry';
import {listWorkspacePages,getWorkspacePage,changeWorkspacePageLifecycle,getWorkspacePageRevisions} from './page-lifecycle';
import {listNotificationTemplates,getNotificationTemplate,createNotificationTemplate,updateNotificationTemplate,previewNotificationTemplate,commandNotificationTemplate,listNotificationDeliveries} from './notification-templates';
import {searchPublicResources} from './resources';
import { dryRunCrmAutomation, enqueueCrmAutomationRun, listCrmAutomationRuns } from "./automation";
async function handleRequest(request:Request,parts:string[]):Promise<Response>{
    const requestId=randomUUID();
    const start=Date.now();
    const path=parts.join('/').replace(/\/+$/,'');
    const method=request.method.toUpperCase();
    const dispatch = async () => {
        try {
            if (path === "health/live")
                return json({status:'ok',version:releaseVersion(),applicationVersion});
            if (['health','health/ready'].includes(path)) {
                try {
                    await query('SELECT 1');
                }
                catch {
                    return json({status:'degraded',database:'unavailable',timestamp:new Date().toISOString()},503);
                }
                try {
                    await (assertPrivacyReady)();
                }
                catch {
                    return (json)({ status: "degraded", database: "ok", privacy: "reconciliation-required", timestamp: new Date().toISOString() }, 503);
                }
                return (json)({ status: "ok", database: "ok", privacy: "ready", timestamp: new Date().toISOString(), version: releaseVersion(), applicationVersion });
            }
            await (assertPrivacyReady)();
            if(path==='public/search'&&method==='GET'){await rateLimit('public-search:'+visitorKey(request),60,60);return json(await searchPublicContent(Object.fromEntries(new URL(request.url).searchParams)),200,{'Cache-Control':'no-store'});}
            if(path==='auth/otp/status'&&method==='GET')return json(customerOtpStatus());
            if(path==='public/resource-search'&&method==='GET'){await rateLimit('public-resource-search:'+visitorKey(request),60,60);return json(await searchPublicResources(Object.fromEntries(new URL(request.url).searchParams)),200,{'Cache-Control':'no-store'});}
            if (parts[0] === "content-previews" && parts.length === 2 && method === "GET")
                return await (contentPreviewResponse)(request, parts[1]);
            if (parts[0] === "wishlist-shares" && parts.length === 2 && method === "GET")
                return await (wishlistShareResponse)(request, parts[1]);
            if (parts[0] === "surveys" && parts[1] === "forms" && parts.length === 3 && ['GET','POST'].includes(method))
                return await (crmSurveyResponse)(request, parts[2]);
            if (parts[0] === "communication-preferences" && parts.length === 2 && ["GET", "PATCH"].includes(method))
                return await (contactPreferencesResponse)(request, parts[1]);
            if (parts[0] === "communication-unsubscribe" && parts.length === 2 && ['GET','POST'].includes(method))
                return await (contactUnsubscribeResponse)(request, parts[1]);
            if (path === "webhooks/openrouter" && method === "POST")
                return json(await openrouterWebhook(request));
            if (parts[0] === "connectors" && parts.length === 3 && parts[2] === "events" && method === "POST")
                return (json)(await (receiveCrmConnectorEvent)(request, parts[1]));
            if (parts[0] === "notifications" && parts[1] === "unsubscribe" && parts.length === 3 && ['GET','POST'].includes(method))
                return await unsubscribeResponse(request,parts[2]);
            if (parts[0] === "communication-verification" && parts.length === 2 && ["GET", "PATCH"].includes(method))
                return await (communicationVerificationResponse)(request, parts[1]);
            if (path === "communication-channels/telegram-webhook" && method === "POST")
                return await (telegramVerificationWebhook)(request);
            if (parts[0] === "communication-preferences" && parts[2] === "channels" && (parts.length === 3 && ['GET','POST'].includes(method) || parts.length === 4 && ["PATCH", "DELETE"].includes(method)))
                return await (communicationPreferenceChannelsResponse)(request, parts[1], parts[3]);
            if (path === "company-certificates" && method === "GET" && new URL(request.url).searchParams.get("manage") !== "true")
                return json(await listPublicCompanyCertificates(new URL(request.url).searchParams.get("locale") || "fa"));
            const session=await sessionFor(request);
            if (path === "auth/session" && method === "GET")
                return await sessionResponse(request,session);
            if(path==='media/policy'&&method==='GET')
                return json(await publicUploadPolicy(session?.actor||null,!!guestHash(request)),200,{'Cache-Control':'private, no-store'});
            if(path==='public/product-registry'&&method==='GET')return json(await lookupProductRegistry(request,Object.fromEntries(new URL(request.url).searchParams)),200,{'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow'});
            if (!['GET','HEAD','OPTIONS'].includes(method)) {
                csrf(request,session);
                await rateLimit('api:'+visitorKey(request),240,60);
            }
            const body=()=>readJson(request,path==='workspace'?12*1024*1024:path.startsWith('ai')?7*1024*1024:1024*1024);
            if (path === "telemetry/config" && method === "GET")
                return (json)((browserMeasurementConfig)(), 200, { "Cache-Control": "no-store" });
            if (path === "telemetry" && method === "POST")
                return (json)(await (recordBrowserMeasurement)(request, await (readJson)(request, 8192)), 202);
            if (path === "crm/contact-endpoints/confirm" && method === "POST")
                return (json)(await (confirmCrmContactEndpoint)(request, await body()), 200, { "Cache-Control": "no-store" });
            if(path==='auth/otp/request'&&method==='POST')return json(await requestCustomerOtp(request,await body()),202);
            if(path==='auth/otp/verify'&&method==='POST')return await verifyCustomerOtp(request,await body());
            if(path==='public/engagement'&&method==='GET'){await rateLimit('engagement-read:'+visitorKey(request),180,60);return json(await getEngagement(session?.actor||null,Object.fromEntries(new URL(request.url).searchParams)));}
            if(path==='public/engagement/view'&&method==='POST')return json(await recordContentView(request,await body()));
            if(path==='public/engagement/comment'&&method==='POST')return json(await createContentComment(requireActor(session),await body()),201);
            if(path==='public/engagement/like'&&method==='POST')return json(await setContentLike(requireActor(session),await body()));
            if(path==='public/engagement/report'&&method==='POST')return json(await createContentReport(requireActor(session),await body()),201);
            if (path === "auth/login" && method === "POST")
                return await login(request,await body());
            if (path === "auth/register" && method === "POST")
                return await register(request,await body());
            if (path === "auth/mfa/verify" && method === "POST")
                return await verifyMfa(request,await body());
            if (path === "auth/logout" && method === "POST")
                return await logout(session);
            if (path === "auth/password/forgot" && method === "POST")
                return json(await forgotPassword(request,await body()));
            if (path === "auth/password/reset" && method === "POST") {
                await rateLimit('reset-confirm:'+visitorKey(request),10,900);
                return json(await resetPassword(await body()));
            }
            if (path === "site" && method === "GET") {
                const data=await getPublicSite();
                return json(data,200,{'Cache-Control':'public, max-age=0, must-revalidate','ETag':'"site-'+data.version+'"'});
            }
            if (path === "ai/status" && method === "GET")
                return json(aiStatus());
            if (path === "tenders" && method === "GET")
                return (json)(await (listPublicTenders)(new URL(request.url).searchParams.get('locale') || "fa"));
            if (parts[0] === "tenders" && parts.length === 2 && method === "GET")
                return (json)(await (getPublicTender)(parts[1], new URL(request.url).searchParams.get('locale') || "fa"));
            if (path === "representatives" && method === "GET")
                return (json)(await (listPublicRepresentatives)(Object.fromEntries(new URL(request.url).searchParams)));
            if (parts[0] === "representatives" && parts.length === 2 && method === "GET")
                return (json)(await (getPublicRepresentative)(parts[1], new URL(request.url).searchParams.get('locale') || "fa"));
            if (parts[0] === "representatives" && parts.length === 3 && parts[2] === "corrections" && method === "POST")
                return (json)(await (createRepresentativeCorrection)(request, session?.actor || null, parts[1], await body(), request.headers.get('idempotency-key') || ""), 201);
            if (path === "resources" && method === "GET") {
                const search=new URL(request.url).searchParams;
                return (json)(await (listResources)(session?.actor || null, { locale: search.get('locale') || "fa", roomId: search.get("roomId") || void 0 }));
            }
            if (path === "resources/bundle" && method === "POST")
                return await (resourceBundle)(session?.actor || null, await body(), visitorKey(request));
            if (parts[0] === "resources" && parts.length === 2 && parts[1] !== "manage" && method === "GET")
                return (json)(await (getResource)(session?.actor || null, parts[1], new URL(request.url).searchParams.get('locale') || "fa"));
            if (parts[0] === "resources" && parts.length === 5 && parts[2] === "versions" && parts[4] === "content" && method === "GET")
                return await (resourceContent)(session?.actor || null, parts[1], parts[3], request);
            if (path === "event-sessions" && method === "GET") {
                const search=new URL(request.url).searchParams;
                return json(await listEventSessions(null,{recordId:search.get('recordId')||undefined,kind:search.get('kind')||undefined,locale:search.get('locale')||'fa'}));
            }
            if (parts[0] === "event-sessions" && parts.length === 3 && parts[2] === "calendar" && method === "GET") {
                const locale=new URL(request.url).searchParams.get('locale')||'fa';
                assert(['fa','en','tr','ar','ru'].includes(locale),422,'LOCALE','Select a supported language.');
                return await eventCalendar(parts[1],locale as 'fa'|'en'|'tr'|'ar'|'ru');
            }
            if ((path === "ai/chat" || path === "ai/generate") && method === "POST")
                return json(await generateAi(session?.actor||null,visitorKey(request),await body(),path==='ai/chat',request.signal));
            if (path === "requests" && method === "GET")
                return json(await listRequests(session?.actor||null,guestHash(request)));
            if (path === "requests" && method === "POST")
                return json(await createRequest(request,session?.actor||null,await body(),request.headers.get('idempotency-key')||''),201);
            if (parts[0] === "requests" && parts.length === 2) {
                if (method === "GET")
                    return json(await getRequest(session?.actor||null,parts[1],guestHash(request)));
                if (method === "PATCH")
                    return json(await patchRequest(session?.actor||null,parts[1],guestHash(request),await body(),expectedVersion(request)));
            }
            if (parts[0] === "requests" && parts[2] === "quotes" && parts[4] === "pdf" && parts.length === 5 && method === "GET")
                return await quotePdf(session?.actor||null,parts[1],parts[3],guestHash(request));
            if (path === "attachments" && method === "POST")
                return json(await upload(request,session?.actor||null,true),201);
            if (parts[0] === "attachments" && parts.length === 2 && ["GET","HEAD"].includes(method))
                return await assetResponse(parts[1],session?.actor||null,guestHash(request),request,true);
            if (parts[0] === "media" && parts[2] === "content" && parts.length === 3 && ["GET","HEAD"].includes(method))
                return await assetResponse(parts[1],session?.actor||null,guestHash(request),request);
            const actor=requireActor(session,path.startsWith('me/')||path.startsWith('auth/'));
            if(path==='engagement/moderation'&&method==='GET')return json(await listContentModeration(actor,Object.fromEntries(new URL(request.url).searchParams)));
            if(parts[0]==='engagement'&&['comments','reports'].includes(parts[1])&&parts.length===3&&method==='PATCH')return json(await moderateContent(actor,parts[1] as 'comments'|'reports',parts[2],await body()));
            if(path==='analytics/content'&&method==='GET')return json(await contentAnalytics(actor,Object.fromEntries(new URL(request.url).searchParams)));
            if(path==='usage'&&method==='GET')return json(await getProviderUsage(actor,Object.fromEntries(new URL(request.url).searchParams)));
            if(path==='ai/assist/capabilities'&&method==='GET')return json(await staffAssistanceCapabilities(actor));
            if(path==='ai/assist'&&method==='POST')return json(await generateStaffAssistance(actor,visitorKey(request),await body(),request.signal));
            if(path==='admin/storage-policy'){
                if(method==='GET')return json(await getManagedStoragePolicy(actor));
                if(method==='PUT')return json(await saveManagedStoragePolicy(actor,await body()));
            }
            if(path==='admin/product-registry'&&method==='GET')return json(await listProductRegistry(actor,Object.fromEntries(new URL(request.url).searchParams)));
            if(path==='admin/product-registry'&&method==='POST')return json(await createProductRegistry(actor,await body()),201);
            if(parts[0]==='admin'&&parts[1]==='product-registry'&&parts.length===3&&method==='PATCH')return json(await updateProductRegistry(actor,parts[2],await body()));
            if(parts[0]==='admin'&&parts[1]==='product-registry'&&parts.length===4&&parts[3]==='lifecycle'&&method==='POST')return json(await changeProductRegistryState(actor,parts[2],await body()));
            if(path==='communications/templates'&&method==='GET')return json(await listNotificationTemplates(actor,Object.fromEntries(new URL(request.url).searchParams)));
            if(path==='communications/templates'&&method==='POST')return json(await createNotificationTemplate(actor,await body()),201);
            if(parts[0]==='communications'&&parts[1]==='templates'&&parts.length===3&&method==='GET')return json(await getNotificationTemplate(actor,parts[2]));
            if(parts[0]==='communications'&&parts[1]==='templates'&&parts.length===3&&method==='PUT')return json(await updateNotificationTemplate(actor,parts[2],await body()));
            if(parts[0]==='communications'&&parts[1]==='templates'&&parts.length===4&&parts[3]==='preview'&&method==='POST')return json(await previewNotificationTemplate(actor,parts[2],await body()));
            if(parts[0]==='communications'&&parts[1]==='templates'&&parts.length===4&&parts[3]==='commands'&&method==='POST')return json(await commandNotificationTemplate(actor,parts[2],await body()));
            if(path==='communications/deliveries'&&method==='GET')return json(await listNotificationDeliveries(actor,Object.fromEntries(new URL(request.url).searchParams)));
            if(path==='workspace/forms'&&method==='GET')return json(await listWorkspaceForms(actor,Object.fromEntries(new URL(request.url).searchParams)));
            if(path==='workspace/pages'&&method==='GET')return json(await listWorkspacePages(actor,Object.fromEntries(new URL(request.url).searchParams)));
            if(parts[0]==='workspace'&&parts[1]==='pages'&&parts.length===3&&method==='GET')return json(await getWorkspacePage(actor,parts[2]));
            if(parts[0]==='workspace'&&parts[1]==='pages'&&parts.length===4&&parts[3]==='lifecycle'&&method==='POST')return json(await changeWorkspacePageLifecycle(actor,parts[2],await body(),contentLeaseTokens(request)));
            if(parts[0]==='workspace'&&parts[1]==='pages'&&parts.length===4&&parts[3]==='revisions'&&method==='GET')return json(await getWorkspacePageRevisions(actor,parts[2],new URL(request.url).searchParams.get('locale')||'fa'));
            if(path==='workspace/forms'&&method==='POST')return json(await saveWorkspaceForm(actor,null,await body(),contentLeaseTokens(request)),201);
            if(parts[0]==='workspace'&&parts[1]==='forms'&&parts.length===3&&method==='GET')return json(await getWorkspaceForm(actor,parts[2]));
            if(parts[0]==='workspace'&&parts[1]==='forms'&&parts.length===3&&method==='PUT')return json(await saveWorkspaceForm(actor,parts[2],await body(),contentLeaseTokens(request)));
            if(parts[0]==='workspace'&&parts[1]==='forms'&&parts.length===4&&parts[3]==='lifecycle'&&method==='POST')return json(await changeWorkspaceFormLifecycle(actor,parts[2],await body(),contentLeaseTokens(request)));
            if(parts[0]==='workspace'&&parts[1]==='forms'&&parts.length===4&&parts[3]==='restore'&&method==='POST')return json(await restoreWorkspaceFormRevision(actor,parts[2],await body(),contentLeaseTokens(request)));
            if(parts[0]==='workspace'&&parts[1]==='forms'&&parts.length===4&&parts[3]==='revisions'&&method==='GET')return json(await getFormRevisions(actor,parts[2],new URL(request.url).searchParams.get('locale')||'fa'));
            if(parts[0]==='workspace'&&parts[1]==='revisions'&&parts.length===3&&method==='GET')return json(await getEditorRevisionDetail(actor,parts[2]));
            if(path==='workspace/translations'&&method==='GET')return json(await getTranslationStatus(actor,Object.fromEntries(new URL(request.url).searchParams)));
            if(path==='workspace/translations/propose'&&method==='POST')return json(await proposeContentTranslation(actor,await body(),request.signal));
            if(path==='workspace/translations/apply'&&method==='POST')return json(await applyContentTranslation(actor,await body(),contentLeaseTokens(request)));
            if(path==='workspace/translations/acknowledge'&&method==='POST')return json(await acknowledgeTranslation(actor,await body(),contentLeaseTokens(request)));
            if (path === "company-certificates") {
                if (method === "GET") return json(await listManagedCompanyCertificates(actor,new URL(request.url).searchParams.get("locale") || "fa"));
                if (method === "POST") return json(await createCompanyCertificate(actor,await body()),201);
            }
            if (path === "company-certificates/sources" && method === "GET")
                return json(await listCompanyCertificateSources(actor,new URL(request.url).searchParams.get("locale") || "fa"));
            if (parts[0] === "company-certificates" && parts.length === 2 && method === "PUT")
                return json(await updateCompanyCertificate(actor,parts[1],await body()));
            if (parts[0] === "company-certificates" && parts.length === 3 && method === "POST") {
                const commands = {review:reviewCompanyCertificate,publish:publishCompanyCertificate,withdraw:withdrawCompanyCertificate,revoke:revokeCompanyCertificate,state:setCompanyCertificateState};
                const action = parts[2];
                if (Object.hasOwn(commands,action)) return json(await commands[action as keyof typeof commands](actor,parts[1],await body()));
            }

            if (path === "auth/mfa/enroll" && method === "POST")
                return json(await enrollMfa(session!,await body()));
            if (path === "auth/mfa/confirm" && method === "POST")
                return json(await confirmMfa(session!,await body()));
            if (path === "auth/mfa/disable" && method === "POST")
                return json(await disableMfa(session!,await body()));
            if (path === "auth/mfa/recovery-codes" && method === "POST")
                return json(await regenerateRecoveryCodes(session!,await body()));
            if (path === "auth/password/change" && method === "POST")
                return json(await changePassword(session!,await body()));
            if (path === "auth/email/request" && method === "POST")
                return json(await requestEmailVerification(session!,await body()),202);
            if (path === "auth/email/confirm" && method === "POST")
                return json(await confirmEmailVerification(session!,await body()));
            if (path === "auth/phone/request" && method === "POST")
                return json(await requestPhoneVerification(session!,await body()),202);
            if (path === "auth/phone/confirm" && method === "POST")
                return json(await confirmPhoneVerification(session!,await body()));
            if (parts[0] === "auth" && parts[1] === "sessions" && parts.length === 3 && method === "DELETE")
                return json(await revokeSession(session!,parts[2]));
            if (path === "me/security" && method === "GET")
                return json(await security(session!));
            if (path === "me/settings" && method === "GET")
                return json(await getSettings(actor));
            if (parts[0] === "me" && parts[1] === "communication-channels" && parts.length === 3) {
                if (method === "PATCH")
                    return (json)(await (updateCommunicationChannel)(actor, parts[2], await body(), expectedVersion(request)));
                if (method === "DELETE")
                    return (json)(await (revokeCommunicationChannel)(actor, parts[2], expectedVersion(request)));
            }
            if (path === "me/communication-channels") {
                if (method === "GET")
                    return (json)(await (getCommunicationChannels)(actor));
                if (method === "POST")
                    return (json)(await (connectCommunicationChannel)(actor, await body()), 202);
            }
            if (path === "me/storage" && method === "GET")
                return (json)(await (storageUsage)(actor.id));
            if (path === "me/attachments" && method === "GET")
                return (json)(await (listOwnAttachments)(actor));
            if ((path === "me/profile" || path === "me/preferences") && method === "PATCH")
                return json(await patchSettings(actor,path==='me/profile'?'profile':'preferences',await body(),expectedVersion(request)));
            if (path === "me/collection") {
                if (method === "GET")
                    return json(await getCollection(actor));
                if (method === "PATCH")
                    return json(await patchCollection(actor,await body()));
            }
            if (path === "me/collection/merge" && method === "POST")
                return (json)(await (mergeGuestInquiries)(actor, await body()));
            if (path === "me/tender-bids" && method === "GET")
                return (json)(await (listOwnTenderBids)(actor, Object.fromEntries(new URL(request.url).searchParams)));
            if (parts[0] === "tenders" && parts.length === 3 && parts[2] === "bids" && method === "POST")
                return (json)(await (submitTenderBid)(request, actor, parts[1], await body(), request.headers.get('idempotency-key') || ""), 201);
            if (parts[0] === "tender-bids" && parts.length === 2) {
                if (method === "GET")
                    return (json)(await (getTenderBid)(actor, parts[1]));
                if (method === "PUT")
                    return (json)(await (replaceTenderBid)(request, actor, parts[1], await body(), request.headers.get('idempotency-key') || ""));
            }
            if (parts[0] === "tender-bids" && parts.length === 3 && parts[2] === "withdraw" && method === "POST")
                return (json)(await (withdrawTenderBid)(actor, parts[1], await body()));
            if (parts[0] === "tender-bids" && parts.length === 4 && parts[2] === "revisions" && method === "GET")
                return (json)(await (getTenderBid)(actor, parts[1], parts[3]));
            if (parts[0] === "tender-bids" && parts.length === 8 && parts[2] === "revisions" && parts[4] === "envelopes" && parts[6] === "assets" && method === "GET") {
                (assert)(parts[5] === "technical" || parts[5] === "financial", 404, "NOT_FOUND", "Envelope not found.");
                return await (tenderEnvelopeResponse)(actor, parts[1], parts[3], parts[5], parts[7], request);
            }
            if (path === "crm/tenders") {
                if (method === "GET")
                    return (json)(await (listManagedTenders)(actor));
                if (method === "POST")
                    return (json)(await (createTender)(actor, await body()), 201);
            }
            if (parts[0] === "crm" && parts[1] === "tenders" && parts.length === 3) {
                if (method === "GET")
                    return (json)(await (getManagedTender)(actor, parts[2]));
                if (method === "PUT")
                    return (json)(await (updateTender)(actor, parts[2], await body()));
            }
            if (parts[0] === "crm" && parts[1] === "tenders" && parts.length === 4) {
                if (parts[3] === "review" && method === "POST")
                    return (json)(await (reviewTender)(actor, parts[2], await body()));
                if (parts[3] === "state" && method === "POST")
                    return (json)(await (changeTenderState)(actor, parts[2], await body()));
                if (parts[3] === "reviewers") {
                    if (method === "GET")
                        return (json)(await (getTenderReviewers)(actor, parts[2]));
                    if (method === "PUT")
                        return (json)(await (setTenderReviewers)(actor, parts[2], await body()));
                }
                if (parts[3] === "bids" && method === "GET")
                    return (json)(await (listTenderBids)(actor, parts[2], Object.fromEntries(new URL(request.url).searchParams)));
            }
            if (parts[0] === "crm" && parts[1] === "tender-bids" && parts.length === 4 && method === "POST") {
                if (parts[3] === "technical-review")
                    return (json)(await (reviewTenderTechnical)(actor, parts[2], await body()));
                if (parts[3] === "finance-open")
                    return (json)(await (openTenderFinance)(actor, parts[2], await body()));
            }
            if (path === "crm/portal-organizations" && method === "GET")
                return (json)(await (listManagedPortalOrganizations)(actor, Object.fromEntries(new URL(request.url).searchParams)));
            if (parts[0] === "crm" && parts[1] === "partner-profiles" && parts.length === 3) {
                if (method === "GET")
                    return (json)(await (getPartnerPublicProfile)(actor, parts[2], new URL(request.url).searchParams.get('locale') || "fa"));
                if (method === "PUT")
                    return (json)(await (savePartnerPublicProfile)(actor, parts[2], await body()));
            }
            if (parts[0] === "crm" && parts[1] === "partner-profiles" && parts.length === 4) {
                if (parts[3] === "commands" && method === "POST")
                    return (json)(await (commandPartnerPublicProfile)(actor, parts[2], await body(), expectedVersion(request)));
                if (parts[3] === "history" && method === "GET")
                    return (json)(await (partnerProfileHistory)(actor, parts[2], new URL(request.url).searchParams.get("before")));
            }
            if (parts[0] === "crm" && parts[1] === "contacts" && parts.length === 4 && parts[3] === "communication-channels") {
                if (method === "GET")
                    return (json)(await (getContactChannels)(actor, parts[2]));
                if (method === "POST")
                    return (json)(await (requestContactChannel)(actor, parts[2], await body()), 202);
            }
            if (path === "crm/campaign-recipients" && method === "GET")
                return (json)(await (searchCrmCampaignRecipients)(actor, Object.fromEntries(new URL(request.url).searchParams)));
            if (parts[0] === "crm" && parts[1] === "contacts" && parts.length === 6 && parts[3] === "endpoints" && parts[5] === "preferences" && method === "POST")
                return (json)(await (requestContactPreferences)(actor, parts[2], parts[4]), 202);
            if (parts[0] === "crm" && parts[1] === "portal-organizations" && parts.length === 3 && method === "GET")
                return (json)(await (getManagedPortalOrganization)(actor, parts[2]));
            if (parts[0] === "crm" && parts[1] === "portal-organizations" && parts.length === 4) {
                if (parts[3] === "accounts" && method === "GET")
                    return (json)(await (listPortalCrmAccountCandidates)(actor, parts[2], Object.fromEntries(new URL(request.url).searchParams)));
                if (parts[3] === "account" && method === "PUT")
                    return (json)(await (linkPortalOrganizationAccount)(actor, parts[2], await body()));
                if (parts[3] === "history" && method === "GET")
                    return (json)(await (getPortalOrganizationLinkHistory)(actor, parts[2]));
            }
            if (path === "me/wishlists") {
                if (method === "GET")
                    return (json)(await (listWishlists)(actor));
                if (method === "POST")
                    return (json)(await (createWishlist)(actor, await body(), new URL(request.url).searchParams.get('locale') || "fa"), 201);
            }
            if (path === "me/wishlist-catalog" && method === "GET")
                return (json)(await (wishlistCatalog)(actor, Object.fromEntries(new URL(request.url).searchParams)));
            if (parts[0] === "me" && parts[1] === "wishlists" && parts.length >= 3) {
                const locale=new URL(request.url).searchParams.get('locale')||'fa';
                if (parts.length === 3) {
                    if (method === "GET")
                        return (json)(await (getWishlist)(actor, parts[2], locale));
                    if (method === "PUT")
                        return (json)(await (updateWishlist)(actor, parts[2], await body(), expectedVersion(request), locale));
                    if (method === "DELETE")
                        return (json)(await (deleteWishlist)(actor, parts[2], expectedVersion(request)));
                }
                if (parts.length === 4 && parts[3] === "transfer" && method === "POST")
                    return (json)(await (transferWishlistItems)(actor, parts[2], await body(), expectedVersion(request), locale));
                if (parts.length === 4 && parts[3] === "share-preview" && method === "GET")
                    return (json)(await (previewWishlistShare)(actor, parts[2], locale));
                if (parts.length === 4 && parts[3] === "shares") {
                    if (method === "GET")
                        return (json)(await (listWishlistShares)(actor, parts[2]));
                    if (method === "POST")
                        return (json)(await (createWishlistShare)(actor, parts[2], await body(), expectedVersion(request)), 201);
                }
                if (parts.length === 5 && parts[3] === "shares" && method === "DELETE")
                    return (json)(await (revokeWishlistShare)(actor, parts[2], parts[4], expectedVersion(request)));
            }
            if (path === "me/portal") {
                if (method === "GET")
                    return json(await getPortal(actor));
                if (method === "PATCH")
                    return json(await patchPortal(actor,await body()));
            }
            if (path === "me/organizations") {
                if (method === "GET")
                    return json(await getOrganizations(actor));
                if (method === "POST")
                    return json(await createOrganization(actor,await body()),201);
            }
            if (path === "me/organization-invitations/accept" && method === "POST")
                return json(await acceptOrganizationInvitation(actor,await body()));
            if (parts[0] === "me" && parts[1] === "organizations") {
                if (parts.length === 3) {
                    if (method === "PATCH")
                        return json(await updateOrganization(actor,parts[2],await body(),expectedVersion(request)));
                    if (method === "DELETE")
                        return json(await deleteOrganization(actor,parts[2],expectedVersion(request)));
                }
                if (parts.length === 4 && parts[3] === "invitations" && method === "POST")
                    return json(await inviteOrganizationMember(actor,parts[2],await body()),202);
                if (parts.length === 5 && parts[3] === "members" && method === "DELETE")
                    return json(await revokeOrganizationMember(actor,parts[2],parts[4]));
                if (parts.length === 5 && parts[3] === "requests") {
                    if (method === "PUT")
                        return json(await shareOrganizationRequest(actor,parts[2],parts[4],await body()));
                    if (method === "DELETE")
                        return json(await shareOrganizationRequest(actor,parts[2],parts[4],null,true));
                }
            }
            if (path === "me/notifications" && method === "GET")
                return json(await notifications(actor));
            if (path === "me/bookings" && method === "GET")
                return json(await listOwnBookings(actor));
            if (path === "me/data-rooms" && method === "GET")
                return (json)(await (listDataRooms)(actor, new URL(request.url).searchParams.get('locale') || "fa"));
            if (path === "me/notification-preferences") {
                if (method === "GET")
                    return json(await getNotificationPreferences(actor));
                if (method === "PATCH")
                    return json(await patchNotificationPreferences(actor,await body()));
            }
            if (parts[0] === "me" && parts[1] === "notifications" && parts.length === 3 && method === "PATCH")
                return json(await readNotification(actor,parts[2]));
            if (path === "workspace") {
                if (method === "GET")
                    return json(await getWorkspace(actor));
                if (method === "PUT")
                    return (json)(await (saveWorkspace)(actor, await body(), (contentLeaseTokens)(request)));
            }
            if (path === "staff/invitations") {
                if (method === "GET")
                    return (json)(await (listStaffInvitations)(actor));
                if (method === "POST")
                    return (json)(await (createStaffInvitation)(actor, await body()), 201);
            }
            if (path === "staff/invitations/accept" && method === "POST")
                return (json)(await (acceptStaffInvitation)(actor, await body()));
            if (parts[0] === "staff" && parts[1] === "invitations" && parts.length === 3 && method === "DELETE")
                return (json)(await (revokeStaffInvitation)(actor, parts[2], await body()));
            if (parts[0] === "staff" && parts.length === 3 && parts[2] === "handover" && method === "GET")
                return (json)(await (previewStaffHandover)(actor, parts[1]));
            if (parts[0] === "staff" && parts.length === 3 && parts[2] === "offboard" && method === "POST")
                return (json)(await (offboardStaff)(actor, parts[1], await body()));
            if (path === "content/blocks") {
                if (method === "GET")
                    return (json)(await (listSharedBlocks)(actor, { cursor: new URL(request.url).searchParams.get("cursor") || void 0 }));
                if (method === "POST")
                    return (json)(await (createSharedBlock)(actor, await body()), 201);
            }
            if (path === "content/blocks/detach" && method === "POST")
                return (json)(await (detachSharedBlock)(actor, await body(), (contentLeaseTokens)(request)));
            if (parts[0] === "content" && parts[1] === "blocks" && parts.length === 3) {
                if (method === "GET")
                    return (json)(await (getSharedBlock)(actor, parts[2]));
                if (method === "PATCH")
                    return (json)(await (updateSharedBlock)(actor, parts[2], await body()));
            }
            if (parts[0] === "content" && parts[1] === "blocks" && parts.length === 4) {
                if (parts[3] === "revisions") {
                    if (method === "GET") {
                        const params = new URL(request.url).searchParams;
                        return (json)(await (getSharedBlockHistory)(actor, parts[2], { cursor: params.get("cursor") || void 0, locale: params.get("locale") || void 0 }));
                    }
                    if (method === "POST")
                        return (json)(await (createSharedBlockRevision)(actor, parts[2], await body()), 201);
                }
                if (parts[3] === "impact" && method === "GET")
                    return (json)(await (getSharedBlockImpact)(actor, parts[2]));
                if (parts[3] === "attach" && method === "POST")
                    return (json)(await (attachSharedBlock)(actor, parts[2], await body(), (contentLeaseTokens)(request)));
                if (parts[3] === "apply" && method === "POST")
                    return (json)(await (applySharedBlockRevision)(actor, parts[2], await body(), (contentLeaseTokens)(request)));
            }
            if (parts[0] === "content" && parts[1] === "blocks" && parts.length === 5 && parts[3] === "revisions" && method === "GET")
                return (json)(await (getSharedBlockRevision)(actor, parts[2], parts[4]));
            if (path === "content/leases") {
                if (method === "GET") {
                    const params = new URL(request.url).searchParams;
                    return (json)(await (getContentLease)(actor, { bucket: params.get("bucket"), id: params.get("id") }));
                }
                if (method === "POST")
                    return (json)(await (acquireContentLease)(actor, await body()), 201);
            }
            if (parts[0] === "content" && parts[1] === "leases" && parts.length === 3 && ["PUT", "DELETE"].includes(method))
                return (json)(await (renewContentLease)(actor, parts[2], await body(), method === "DELETE"));
            if (path === "content/previews") {
                if (method === "GET") {
                    const params = new URL(request.url).searchParams;
                    return (json)(await (listContentPreviews)(actor, { bucket: params.get("bucket"), id: params.get("id") }));
                }
                if (method === "POST")
                    return (json)(await (createContentPreview)(actor, await body()), 201);
            }
            if (parts[0] === "content" && parts[1] === "previews" && parts.length === 3 && method === "DELETE")
                return (json)(await (revokeContentPreview)(actor, parts[2]));
            if (path === "privacy/requests") {
                if (method === "GET")
                    return (json)(await (listPrivacyRequests)(actor));
                if (method === "POST")
                    return (json)(await (createPrivacyRequest)(actor, await body()), 201);
            }
            if (parts[0] === "privacy" && parts[1] === "requests" && parts.length === 3 && method === "GET")
                return (json)(await (getPrivacyRequest)(actor, parts[2]));
            if (parts[0] === "privacy" && parts[1] === "requests" && parts.length === 4) {
                if (parts[3] === "decision" && method === "POST")
                    return (json)(await (decidePrivacyRequest)(actor, parts[2], await body(), expectedVersion(request)));
                if (parts[3] === "export" && method === "GET")
                    return await (exportPrivacyRequest)(actor, parts[2]);
                if (parts[3] === "execute" && method === "POST")
                    return (json)(await (executePrivacyErasure)(actor, parts[2], await body(), expectedVersion(request)));
            }
            if (path === "privacy/holds") {
                if (method === "GET")
                    return (json)(await (listPrivacyHolds)(actor));
                if (method === "POST")
                    return (json)(await (createPrivacyHold)(actor, await body()), 201);
            }
            if (parts[0] === "privacy" && parts[1] === "holds" && parts.length === 3 && ["PATCH", "DELETE"].includes(method))
                return (json)(await (updatePrivacyHold)(actor, parts[2], await body(), expectedVersion(request), method === "DELETE"));
            if (path === "workspace/publish" && method === "POST")
                return json(await publishWorkspace(actor,await body()));
            if (path === "workspace/assign" && method === "POST")
                return (json)(await (assignWorkspaceRecord)(actor, await body()));
            if (path === "workspace/unpublish" && method === "POST")
                return json(await unpublishWorkspace(actor,await body()));
            if (path === "workspace/revisions" && method === "GET") {
                const search=new URL(request.url).searchParams;
                const bucket=search.get('bucket');
                assert(bucket==='records'||bucket==='pages',422,'BUCKET','Use records or pages.');
                return json(await getWorkspaceRevisions(actor,{bucket,id:search.get('id')||'',locale:search.get('locale')||'fa'}));
            }
            if (path === "workspace/restore" && method === "POST")
                return (json)(await (restoreWorkspaceRevision)(actor, await body(), (contentLeaseTokens)(request)));
            if (path === "workspace/review" && method === "POST")
                return json(await reviewWorkspaceContent(actor,await body()));
            if (path === "workspace/schedule" && method === "POST")
                return json(await scheduleWorkspaceContent(actor,await body()));
            if (path === "workspace/schedule/cancel" && method === "POST")
                return json(await cancelWorkspaceSchedule(actor,await body()));
            if (path === "workspace/schedules" && method === "GET")
                return json(await listWorkspaceSchedules(actor));
            if (path === "site-preferences") {
                if (method === "GET")
                    return json(await getSitePreferences(actor));
                if (method === "PUT")
                    return json(await saveSitePreferences(actor,await body()));
            }
            if (path === "users") {
                if (method === "GET")
                    return json(await listUsers(actor,new URL(request.url).searchParams));
                if (method === "POST")
                    return json(await createUser(actor,await body(),session!),201);
            }
            if(parts[0]==="users"&&parts.length===3&&parts[2]==="password"&&method==="POST")
                return json(await resetManagedUserPassword(session!,parts[1],await body()));
            if(parts[0]==="users"&&parts.length===3&&parts[2]==="mfa-reset"&&method==="POST")
                return json(await resetManagedUserMfa(session!,parts[1],await body()));
            if (parts[0] === "users" && parts.length === 2) {
                if (method === "GET")
                    return json(await getManagedUser(actor,parts[1],session!));
                if (method === "PATCH")
                    return json(await updateUser(actor,parts[1],await body(),session!));
                if (method === "DELETE")
                    // Accounts with historical records are retired rather than
                    // physically erased. Preserve the optimistic version so a
                    // stale administrator cannot deactivate a changed account.
                    {const deletion=await body();return json(await updateUser(actor,parts[1],{...(deletion&&typeof deletion==='object'?deletion:{}),active:false},session!));}
            }
            if (path === "crm/scopes" && method === "GET")
                return (json)(await (getCrmScopeDirectory)(actor));
            if (path === "crm/transfers" && method === "GET")
                return (json)(await (listCrmTransfers)(actor));
            if (path === "crm/requests" && method === "GET")
                return (json)(await (listCrmRequests)(actor, Object.fromEntries(new URL(request.url).searchParams)));
            if (path === "crm/transfers/imports" && method === "POST")
                return (json)(await (createCrmImport)(actor, await (readJson)(request, 2 * 524288 + 8192)), 201);
            if (path === "crm/transfers/exports" && method === "POST")
                return (json)(await (createCrmExport)(actor, await body()), 201);
            if (parts[0] === "crm" && parts[1] === "transfers" && parts.length === 3 && method === "GET")
                return (json)(await (getCrmTransfer)(actor, parts[2]));
            if (parts[0] === "crm" && parts[1] === "transfers" && parts.length === 4) {
                if (parts[3] === "rows" && method === "GET")
                    return (json)(await (listCrmTransferRows)(actor, parts[2], { after: Number(new URL(request.url).searchParams.get("after") || 0) }));
                if (parts[3] === "command" && method === "POST")
                    return (json)(await (commandCrmTransfer)(actor, parts[2], await body(), expectedVersion(request)));
                if (parts[3] === "file" && method === "GET") {
                    const file = await (downloadCrmTransfer)(actor, parts[2]);
                    return new Response(file.csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
                }
            }
            if (parts[0] === "crm" && parts[1] === "transfers" && parts.length === 5 && parts[3] === "rows" && method === "PATCH")
                return (json)(await (updateCrmTransferRow)(actor, parts[2], Number(parts[4]), await body(), expectedVersion(request)));
            if (path === "crm/search" && method === "GET") {
                const params = new URL(request.url).searchParams;
                return (json)(await (searchCrmRecords)(actor, { q: params.get("q") || "", collections: params.getAll("collection").length ? params.getAll("collection") : void 0 }));
            }
            if (path === "crm/connectors") {
                if (method === "GET")
                    return (json)(await (listCrmConnectors)(actor));
                if (method === "POST")
                    return (json)(await (createCrmConnector)(actor, await body()), 201, { "Cache-Control": "no-store" });
            }
            if (parts[0] === "crm" && parts[1] === "connectors" && parts.length === 3 && method === "PUT")
                return (json)(await (updateCrmConnector)(actor, parts[2], await body(), expectedVersion(request)));
            if (parts[0] === "crm" && parts[1] === "connectors" && parts.length === 4 && parts[3] === "rotate-secret" && method === "POST")
                return (json)(await (rotateCrmConnectorSecret)(actor, parts[2], await body(), expectedVersion(request)), 200, { "Cache-Control": "no-store" });
            if (path === "crm/inbox-items" && method === "GET") {
                const search=new URL(request.url).searchParams;
                return (json)(await (listCrmInbox)(actor, { state: search.get("state") || void 0, cursor: search.get("cursor") || void 0, limit: Number(search.get('limit') || 30) }));
            }
            if (parts[0] === "crm" && parts[1] === "inbox-items" && parts.length === 3) {
                if (method === "GET")
                    return (json)(await (getCrmInboxItem)(actor, parts[2]));
                if (method === "PATCH")
                    return (json)(await (archiveCrmInboxItem)(actor, parts[2], await body(), expectedVersion(request)));
            }
            if (parts[0] === "crm" && parts[1] === "inbox-items" && parts.length === 4 && parts[3] === "associate" && method === "POST")
                return (json)(await (associateCrmInboxItem)(actor, parts[2], await body(), expectedVersion(request)));
            if (parts[0] === "crm" && parts[1] === "contacts" && parts.length === 6 && parts[3] === "endpoints" && parts[5] === "verification" && method === "POST")
                return (json)(await (requestCrmEndpointVerification)(actor, parts[2], parts[4], await body()), 202);
            if (parts[0] === "crm" && parts[1] === "records" && parts.length === 5 && parts[3] === "evidence" && method === "GET")
                return await (crmEvidenceResponse)(actor, parts[2], parts[4], request);
            if (parts[0] === "crm" && parts[1] === "records" && parts.length === 4 && parts[3] === "domain") {
                if (method === "GET")
                    return (json)(await (getCrmDomain)(actor, parts[2]));
                if (method === "PUT")
                    return (json)(await (saveCrmDomain)(actor, parts[2], await body()));
            }
            if (parts[0] === "crm" && parts[1] === "leads" && parts.length === 4 && parts[3] === "convert" && method === "POST")
                return (json)(await (convertCrmLead)(actor, parts[2], await body()));
            if (parts[0] === "crm" && parts[1] === "samples" && parts.length === 4 && parts[3] === "transition" && method === "POST")
                return (json)(await (transitionCrmSample)(actor, parts[2], await body()));
            if (parts[0] === "crm" && parts[1] === "handoffs" && parts.length === 4 && parts[3] === "transition" && method === "POST")
                return (json)(await (transitionCrmHandoff)(actor, parts[2], await body()));
            if (parts[0] === "crm" && parts[1] === "records" && parts.length === 4 && parts[3] === "timeline" && method === "GET") {
                const search=new URL(request.url).searchParams;
                return (json)(await (listCrmTimeline)(actor, parts[2], { cursor: search.get("cursor") || void 0, limit: Number(search.get('limit') || 30) }));
            }
            if (path === "crm/timeline" && method === "POST")
                return (json)(await (createCrmTimelineEntry)(actor, await body()), 201);
            if (parts[0] === "crm" && parts[1] === "timeline" && parts.length === 3 && ["PATCH", "DELETE"].includes(method))
                return (json)(await (updateCrmTimelineEntry)(actor, parts[2], await body(), expectedVersion(request), method === "DELETE"));
            if (path === "crm/tasks") {
                if (method === "GET")
                    return (json)(await (listCrmTasks)(actor, new URL(request.url).searchParams.get("recordId") || void 0));
                if (method === "POST")
                    return (json)(await (createCrmTask)(actor, await body()), 201);
            }
            if (parts[0] === "crm" && parts[1] === "tasks" && parts.length === 3) {
                if (method === "GET")
                    return (json)(await (getCrmTask)(actor, parts[2]));
                if (["PUT", "DELETE"].includes(method))
                    return (json)(await (updateCrmTask)(actor, parts[2], await body(), expectedVersion(request), method === "DELETE"));
            }
            if (parts[0] === "crm" && parts[1] === "task-occurrences" && parts.length === 3 && method === "PATCH")
                return (json)(await (setCrmTaskOccurrence)(actor, parts[2], await body(), expectedVersion(request)));
            if (path === "crm/reports/forecast" && method === "POST")
                return (json)(await (getCrmForecast)(actor, await body()));
            if (path === "crm/reports/snapshots") {
                if (method === "GET")
                    return (json)(await (listCrmReportSnapshots)(actor));
                if (method === "POST")
                    return (json)(await (createCrmReportSnapshot)(actor, await body()), 201);
            }
            if (parts[0] === "crm" && parts[1] === "reports" && parts[2] === "snapshots" && parts.length === 4 && method === "GET")
                return (json)(await (getCrmReportSnapshot)(actor, parts[3]));
            if (path === "crm/success-plans") {
                if (method === "GET")
                    return (json)(await (listCrmSuccessPlans)(actor, new URL(request.url).searchParams.get("recordId") || ""));
                if (method === "POST")
                    return (json)(await (createCrmSuccessPlan)(actor, await body()), 201);
            }
            if (parts[0] === "crm" && parts[1] === "success-plans" && parts.length === 3 && method === "PUT")
                return (json)(await (updateCrmSuccessPlan)(actor, parts[2], await body(), expectedVersion(request)));
            if (path === "crm/surveys") {
                if (method === "GET")
                    return (json)(await (listCrmSurveys)(actor, new URL(request.url).searchParams.get("requestId") || ""));
                if (method === "POST")
                    return (json)(await (createCrmSurvey)(actor, await body()), 201);
            }
            if (parts[0] === "crm" && parts[1] === "surveys" && parts.length === 3 && method === "DELETE")
                return (json)(await (revokeCrmSurvey)(actor, parts[2]));
            if (path === "crm/segments") {
                if (method === "GET")
                    return (json)(await (listCrmSegments)(actor));
                if (method === "POST")
                    return (json)(await (createCrmSegment)(actor, await body()), 201);
            }
            if (parts[0] === "crm" && parts[1] === "segments" && parts.length === 3) {
                if (method === "GET")
                    return (json)(await (getCrmSegment)(actor, parts[2]));
                if (method === "PATCH")
                    return (json)(await (updateCrmSegment)(actor, parts[2], await body(), expectedVersion(request)));
            }
            if (parts[0] === "crm" && parts[1] === "segments" && parts.length === 4 && method === "POST") {
                if (parts[3] === "preview")
                    return (json)(await (previewCrmSegment)(actor, parts[2], expectedVersion(request)));
                if (parts[3] === "snapshots")
                    return (json)(await (snapshotCrmSegment)(actor, parts[2], expectedVersion(request)), 201);
            }
            if (path === "crm/campaigns") {
                if (method === "GET")
                    return (json)(await (listCrmCampaigns)(actor));
                if (method === "POST")
                    return (json)(await (createCrmCampaign)(actor, await body()), 201);
            }
            if (parts[0] === "crm" && parts[1] === "campaigns" && parts.length === 3) {
                if (method === "GET")
                    return (json)(await (getCrmCampaign)(actor, parts[2]));
                if (method === "PATCH")
                    return (json)(await (updateCrmCampaign)(actor, parts[2], await body(), expectedVersion(request)));
            }
            if (parts[0] === "crm" && parts[1] === "campaigns" && parts.length === 4 && method === "POST") {
                if (parts[3] === "schedule")
                    return (json)(await (scheduleCrmCampaign)(actor, parts[2], await body(), expectedVersion(request)));
                if (parts[3] === "cancel")
                    return (json)(await (cancelCrmCampaign)(actor, parts[2], await body(), expectedVersion(request)));
            }
            if (path === "crm/suppressions") {
                if (method === "GET")
                    return (json)(await (listCrmSuppressions)(actor));
                if (method === "POST")
                    return (json)(await (createCrmSuppression)(actor, await body()), 201);
            }
            if (parts[0] === "crm" && parts[1] === "suppressions" && parts.length === 3 && method === "DELETE")
                return (json)(await (revokeCrmSuppression)(actor, parts[2], await body(), expectedVersion(request)));
            if (path === "crm/pipelines") {
                if (method === "GET")
                    return (json)(await (listCrmPipelines)(actor));
                if (method === "POST")
                    return (json)(await (createCrmPipeline)(actor, await body()), 201);
            }
            if (parts[0] === "crm" && parts[1] === "pipelines" && parts.length === 3 && method === "PUT")
                return (json)(await (saveCrmPipelineDraft)(actor, parts[2], await body()));
            if (parts[0] === "crm" && parts[1] === "pipelines" && parts.length === 4 && parts[3] === "approve" && method === "POST")
                return (json)(await (approveCrmPipeline)(actor, parts[2], await body()));
            if (path === "crm/routing" && method === "GET")
                return (json)(await (getCrmRoutingConfiguration)(actor));
            if (parts[0] === "crm" && parts[1] === "request-routing" && parts.length === 3 && method === "GET")
                return (json)(await (getCrmRequestRouting)(actor, parts[2]));
            if (path === "crm/calendars" && method === "POST")
                return (json)(await (createCrmCalendar)(actor, await body()), 201);
            if (parts[0] === "crm" && parts[1] === "calendars" && parts.length === 3 && method === "PUT")
                return (json)(await (updateCrmCalendar)(actor, parts[2], await body()));
            if (path === "crm/routing-rules" && method === "POST")
                return (json)(await (createCrmRoutingRule)(actor, await body()), 201);
            if (parts[0] === "crm" && parts[1] === "routing-rules" && parts.length === 3 && method === "PUT")
                return (json)(await (updateCrmRoutingRule)(actor, parts[2], await body()));
            if (path === "crm/pricebooks/versions" && method === "GET")
                return (json)(await (listPricebookVersions)(actor));
            if (path === "crm/commercial-policy") {
                if (method === "GET")
                    return (json)(await (getCommercialPolicy)(actor));
                if (method === "PUT")
                    return (json)(await (saveCommercialPolicy)(actor, await body()));
            }
            if (parts[0] === "crm" && ["teams", "territories"].includes(parts[1])) {
                const kind = parts[1] as "teams" | "territories";
                if (parts.length === 2) {
                    if (method === "GET")
                        return (json)(await (listCrmGroups)(actor, kind));
                    if (method === "POST")
                        return (json)(await (createCrmGroup)(actor, kind, await body()), 201);
                }
                if (parts.length === 3) {
                    if (method === "PATCH")
                        return (json)(await (updateCrmGroup)(actor, kind, parts[2], await body(), expectedVersion(request)));
                    if (method === "DELETE")
                        return (json)(await (updateCrmGroup)(actor, kind, parts[2], { active: false }, expectedVersion(request)));
                }
                if (parts.length === 5 && parts[3] === "members" && ["PUT", "DELETE"].includes(method))
                    return (json)(await (setCrmGroupMember)(actor, kind, parts[2], parts[4], method === "PUT", expectedVersion(request)));
            }
            if (path === "media") {
                if (method === "GET")
                    return json(await listMedia(actor));
                if (method === "POST")
                    return json(await upload(request,actor),201);
            }
            if (path === "media/processing" && method === "GET")
                return (json)(await (listMediaProcessing)(actor, Object.fromEntries(new URL(request.url).searchParams)));
            if (parts[0] === "media" && parts.length === 3 && parts[2] === "processing" && method === "POST")
                return (json)(await (createMediaProcessing)(actor, parts[1], await body()), 202);
            if (parts[0] === "media" && parts[1] === "processing" && parts.length === 3 && method === "GET")
                return (json)(await (getMediaProcessing)(actor, parts[2]));
            if (parts[0] === "media" && parts[1] === "processing" && parts.length === 4 && parts[3] === "commands" && method === "POST")
                return (json)(await (commandMediaProcessing)(actor, parts[2], await body(), expectedVersion(request)));
            if (parts[0] === "media" && parts.length === 3) {
                if (parts[2] === "details" && method === "GET")
                    return (json)(await (getDamAsset)(actor, parts[1]));
                if (parts[2] === "rights" && method === "PUT")
                    return (json)(await (updateDamPolicy)(actor, parts[1], await body(), expectedVersion(request)));
                if (parts[2] === "derivatives" && method === "POST")
                    return (json)(await (createImageDerivative)(actor, parts[1], await body()), 201);
            }
            if (parts[0] === "media" && parts.length === 2 && method === "DELETE")
                return json(await deleteMedia(actor,parts[1]));
            if (parts[0] === "requests" && parts.length === 3 && parts[2] === "quotes" && method === "POST")
                return json(await issueQuote(actor,parts[1],await body()),201);
            if (path === "ai/jobs") {
                if (method === "GET")
                    return json(await getAiJobs(actor));
                if (method === "POST")
                    return json(await createAiJob(actor,await body()),202);
            }
            if (path === "ai/knowledge") {
                if (method === "GET")
                    return (json)(await (getKnowledgeIndex)(actor, new URL(request.url).searchParams.get('locale') || "fa"));
                if (method === "POST")
                    return (json)(await (enqueueKnowledgeIndex)(actor, await body()), 202);
            }
            if (parts[0] === "ai" && parts[1] === "knowledge" && parts.length === 5 && parts[2] === "jobs" && parts[4] === "cancel" && method === "POST")
                return (json)(await (cancelKnowledgeJob)(actor, parts[3], expectedVersion(request)));
            if (parts[0] === "ai" && parts[1] === "knowledge" && parts.length === 4 && parts[2] === "sources" && method === "DELETE")
                return (json)(await (removeKnowledgeSource)(actor, parts[3], expectedVersion(request)));
            if (parts[0] === "ai" && parts[1] === "jobs" && parts.length === 3 && method === "GET")
                return json(await getAiJobs(actor,parts[2]));
            if (parts[0] === "ai" && parts[1] === "jobs" && parts[3] === "cancel" && parts.length === 4 && method === "POST")
                return json(await cancelAiJob(actor,parts[2]));
            if (path === "monitoring" && method === "GET")
                return json(await monitoring(actor));
            if (path === "monitoring/incidents") {
                if (method === "GET")
                    return (json)(await (listOperationalIncidents)(actor, Object.fromEntries(new URL(request.url).searchParams)));
                if (method === "POST")
                    return (json)(await (createOperationalIncident)(actor, await body()), 201);
            }
            if (parts[0] === "monitoring" && parts[1] === "incidents" && parts.length === 3 && method === "GET")
                return (json)(await (getOperationalIncident)(actor, parts[2]));
            if (parts[0] === "monitoring" && parts[1] === "incidents" && parts.length === 4 && parts[3] === "transitions" && method === "POST")
                return (json)(await (transitionOperationalIncident)(actor, parts[2], await body(), expectedVersion(request)));
            if (path === "monitoring/slos") {
                if (method === "GET")
                    return (json)(await (listOperationalSlos)(actor));
                if (method === "POST")
                    return (json)(await (createOperationalSlo)(actor, await body()), 201);
            }
            if (parts[0] === "monitoring" && parts[1] === "slos" && parts.length === 3 && method === "PATCH")
                return (json)(await (updateOperationalSlo)(actor, parts[2], await body(), expectedVersion(request)));
            if (parts[0] === "monitoring" && parts.length === 2 && method === "GET")
                return (json)(await (monitoring)(actor, parts[1], Number(new URL(request.url).searchParams.get("minutes") || 60)));
            if (path === "notifications" && method === "POST")
                return json(await enqueueNotification(actor,await body()),202);
            if (path === "resources/manage" && method === "GET")
                return (json)(await (listResources)(actor, { manage: true }));
            if (path === "resources" && method === "POST")
                return (json)(await (createResource)(actor, await body()), 201);
            if (parts[0] === "resources" && parts.length === 2) {
                if (method === "PATCH")
                    return (json)(await (updateResource)(actor, parts[1], await body(), expectedVersion(request)));
                if (method === "DELETE")
                    return (json)(await (updateResource)(actor, parts[1], { status: "archived" }, expectedVersion(request)));
            }
            if (parts[0] === "resources" && parts.length === 3 && parts[2] === "versions" && method === "POST")
                return (json)(await (addResourceVersion)(actor, parts[1], await body(), expectedVersion(request)), 201);
            if (parts[0] === "resources" && parts.length === 5 && parts[2] === "versions" && parts[4] === "review" && method === "POST")
                return (json)(await (reviewResourceVersion)(actor, parts[1], parts[3], await body()));
            if (parts[0] === "resources" && parts.length === 3 && parts[2] === "publish" && method === "POST")
                return (json)(await (publishResource)(actor, parts[1], await body(), expectedVersion(request)));
            if (path === "data-rooms/manage" && method === "GET")
                return (json)(await (listDataRooms)(actor, "fa", true));
            if (path === "data-rooms" && method === "POST")
                return (json)(await (createDataRoom)(actor, await body()), 201);
            if (parts[0] === "data-rooms" && parts.length === 2) {
                if (method === "PATCH")
                    return (json)(await (updateDataRoom)(actor, parts[1], await body(), expectedVersion(request)));
                if (method === "DELETE")
                    return (json)(await (updateDataRoom)(actor, parts[1], { status: "archived" }, expectedVersion(request)));
            }
            if (path === "access-grants" && method === "GET") {
                const search=new URL(request.url).searchParams;
                return (json)(await (listAccessGrants)(actor, { resourceId: search.get("resourceId") || void 0, roomId: search.get("roomId") || void 0 }));
            }
            if (path === "access-grants/subjects" && method === "GET")
                return (json)(await (searchAccessGrantSubjects)(actor, new URL(request.url).searchParams.get("q") || ""));
            if (path === "access-grants" && method === "POST")
                return (json)(await (createAccessGrant)(actor, await body()), 201);
            if (parts[0] === "access-grants" && parts.length === 2 && method === "DELETE")
                return (json)(await (revokeAccessGrant)(actor, parts[1], expectedVersion(request)));
            if (path === "event-sessions/manage" && method === "GET") {
                const search=new URL(request.url).searchParams;
                return json(await listEventSessions(actor,{recordId:search.get('recordId')||undefined,kind:search.get('kind')||undefined,manage:true}));
            }
            if (path === "event-sessions" && method === "POST")
                return json(await createEventSession(actor,await body()),201);
            if (parts[0] === "event-sessions" && parts.length === 2) {
                if (method === "PATCH")
                    return json(await updateEventSession(actor,parts[1],await body(),expectedVersion(request)));
                if (method === "DELETE")
                    return json(await updateEventSession(actor,parts[1],{state:'cancelled'},expectedVersion(request)));
            }
            if (parts[0] === "event-sessions" && parts.length === 3 && parts[2] === "registrations" && method === "GET")
                return json(await listEventAttendees(actor,parts[1]));
            if (path === "automations/dry-run" && method === "POST")
                return json(await dryRunCrmAutomation(actor,await body()));
            if (path === "automations/run" && method === "POST")
                return json(await enqueueCrmAutomationRun(actor,await body()),202);
            if (path === "automations/runs" && method === "GET") {
                const search=new URL(request.url).searchParams;
                return json(await listCrmAutomationRuns(actor,{ruleId:search.get('ruleId')||undefined,limit:Number(search.get('limit')||50)}));
            }
            throw new HttpError(404, "NOT_FOUND", "This API route does not exist.");
        }
        catch (error) {
            return failure(error,requestId);
        }
    };
    const response = await dispatch(), durationMs = Date.now() - start;
    await (recordOperationalRequest)({ requestId, method, path, statusCode: response.status, durationMs });
    if (durationMs > 1e3)
        console.info(JSON.stringify({ event: "api_request", method, path: ["content-previews", "wishlist-shares", "communication-preferences", "communication-unsubscribe", "communication-verification"].includes(parts[0]) ? parts[0] + "/[redacted]" : parts.slice(0,2).join('/'), durationMs, requestId }));
    return response;
}
export { handleRequest };
