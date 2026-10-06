/* eslint-disable react-refresh/only-export-components -- the data router exports route objects beside its boundary components */
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { createBrowserRouter, Link, Outlet, useRouteError } from 'react-router-dom';
import { AppShell } from '@/ui/navigations/AppShell';
import { RequireRole, RequireSession } from '@/ui/navigations/guards';
import { PageLoading } from '@/ui/reusables/PageLoading/PageLoading';

const LandingScreen = lazy(() => import('@/ui/screens/LandingScreen/LandingScreen'));
const DealerLandingScreen = lazy(() => import('@/ui/screens/DealerLandingScreen/DealerLandingScreen'));
const LoginScreen = lazy(() => import('@/ui/screens/LoginScreen/LoginScreen'));
const SignupScreen = lazy(() => import('@/ui/screens/SignupScreen/SignupScreen'));
const SignupChooser = lazy(() => import('@/ui/screens/SignupScreen/SignupScreen').then((module) => ({ default: module.SignupChooser })));
const HomeScreen = lazy(() => import('@/ui/screens/HomeScreen/HomeScreen'));
const RequestsScreen = lazy(() => import('@/ui/screens/RequestsScreen/RequestsScreen'));
const NewRequestScreen = lazy(() => import('@/ui/screens/RequestsScreen/NewRequestScreen'));
const RequestDetailScreen = lazy(() => import('@/ui/screens/RequestDetailScreen/RequestDetailScreen'));
const DealerListScreen = lazy(() => import('@/ui/screens/DealerScreens/DealerListScreen'));
const FeedDetailScreen = lazy(() => import('@/ui/screens/DealerScreens/FeedDetailScreen'));
const QuoteDetailScreen = lazy(() => import('@/ui/screens/DealerScreens/QuoteDetailScreen'));
const ChatScreen = lazy(() => import('@/ui/screens/ChatScreen/ChatScreen'));
const ChatRequestsScreen = lazy(() => import('@/ui/screens/ChatScreen/ChatScreen').then((module) => ({ default: module.ChatRequestsScreen })));
const SupportScreens = lazy(() => import('@/ui/screens/SupportScreens/SupportScreens'));
const AdvisorScreen = lazy(() => import('@/ui/screens/AdvisorScreen/AdvisorScreen'));
const AdministrationScreen = lazy(() => import('@/ui/screens/AdministrationScreen/AdministrationScreen'));
const ProfileScreen = lazy(() => import('@/ui/screens/ProfileScreen/ProfileScreen'));
const BillingScreen = lazy(() => import('@/ui/screens/BillingScreen/BillingScreen'));
const ForgotPasswordScreen = lazy(() => import('@/ui/screens/UtilityScreens/UtilityScreens').then((module) => ({ default: module.ForgotPasswordScreen })));
const LegalScreen = lazy(() => import('@/ui/screens/UtilityScreens/UtilityScreens').then((module) => ({ default: module.LegalScreen })));
const NotFoundScreen = lazy(() => import('@/ui/screens/UtilityScreens/UtilityScreens').then((module) => ({ default: module.NotFoundScreen })));
const UnauthorizedScreen = lazy(() => import('@/ui/screens/UtilityScreens/UtilityScreens').then((module) => ({ default: module.UnauthorizedScreen })));

function RouteErrorScreen() {
  useRouteError();
  return <main className="route-error-page"><section className="card route-error-card" role="alert"><span className="route-error-icon"><AlertTriangle size={24} /></span><h1>Something didn’t load correctly</h1><p>Your account and saved work are safe. Refresh this page, or return to your workspace and try again.</p><div><button type="button" className="button button-primary" onClick={() => window.location.reload()}><RefreshCw size={16} /> Refresh page</button><Link className="button button-secondary" to="/home">Return home</Link></div></section></main>;
}

export const router = createBrowserRouter([{ errorElement: <RouteErrorScreen />, element: <Suspense fallback={<PageLoading label="Opening page" />}><Outlet /></Suspense>, children: [
  { path: '/', element: <LandingScreen /> }, { path: '/dealers', element: <DealerLandingScreen /> }, { path: '/login', element: <LoginScreen /> },
  { path: '/signup', element: <SignupChooser /> }, { path: '/signup/:role', element: <SignupScreen /> },
  { path: '/terms', element: <LegalScreen type="terms" /> }, { path: '/privacy', element: <LegalScreen type="privacy" /> },
  { path: '/forgot-password', element: <ForgotPasswordScreen /> },
  { element: <RequireSession><AppShell /></RequireSession>, children: [
    { path: '/home', element: <HomeScreen /> }, { path: '/unauthorized', element: <UnauthorizedScreen /> },
    { path: '/profiles', element: <ProfileScreen /> },
    { path: '/billing', element: <RequireRole roles={['buyer','dealer']}><BillingScreen /></RequireRole> },
    { path: '/requests', element: <RequireRole roles={['buyer']}><RequestsScreen /></RequireRole> },
    { path: '/requests/new', element: <RequireRole roles={['buyer']}><NewRequestScreen /></RequireRole> },
    { path: '/requests/:id', element: <RequireRole roles={['buyer']}><RequestDetailScreen /></RequireRole> },
    { path: '/orders', element: <RequireRole roles={['buyer']}><DealerListScreen /></RequireRole> },
    { path: '/orders/:id', element: <RequireRole roles={['buyer']}><QuoteDetailScreen deal /></RequireRole> },
    { path: '/chatbot', element: <RequireRole roles={['buyer']}><AdvisorScreen /></RequireRole> },
    { path: '/feed', element: <RequireRole roles={['dealer']}><DealerListScreen /></RequireRole> },
    { path: '/feed/:requestId', element: <RequireRole roles={['dealer']}><FeedDetailScreen /></RequireRole> },
    { path: '/quotes', element: <RequireRole roles={['dealer']}><DealerListScreen /></RequireRole> },
    { path: '/quotes/:id', element: <RequireRole roles={['buyer','dealer']}><QuoteDetailScreen /></RequireRole> },
    { path: '/deals', element: <RequireRole roles={['dealer']}><DealerListScreen /></RequireRole> },
    { path: '/deals/:id', element: <RequireRole roles={['dealer']}><QuoteDetailScreen deal /></RequireRole> },
    { path: '/chat/:quoteId?', element: <RequireRole roles={['buyer','dealer']}><ChatScreen /></RequireRole> },
    { path: '/chat/requests', element: <RequireRole roles={['dealer']}><ChatRequestsScreen /></RequireRole> },
    { path: '/support', element: <RequireRole roles={['support','support-admin','admin']}><SupportScreens /></RequireRole> },
    { path: '/help-support', element: <RequireRole roles={['support','support-admin','admin']}><SupportScreens /></RequireRole> },
    { path: '/tickets', element: <RequireRole roles={['support','support-admin','admin']}><SupportScreens /></RequireRole> },
    { path: '/tickets/:ticketId', element: <RequireRole roles={['support','support-admin','admin']}><SupportScreens /></RequireRole> },
    { path: '/verifications', element: <RequireRole roles={['support','support-admin','admin']}><SupportScreens /></RequireRole> },
    { path: '/support-members', element: <RequireRole roles={['support','support-admin','admin']}><SupportScreens /></RequireRole> },
    { path: '/support-administration', element: <RequireRole roles={['support-admin','admin']}><AdministrationScreen /></RequireRole> },
  ]},
  { path: '*', element: <NotFoundScreen /> },
] }]);
