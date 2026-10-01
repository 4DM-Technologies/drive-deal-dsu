import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from '@/ui/navigations/AppShell';
import { RequireRole, RequireSession } from '@/ui/navigations/guards';
import LandingScreen from '@/ui/screens/LandingScreen/LandingScreen';
import DealerLandingScreen from '@/ui/screens/DealerLandingScreen/DealerLandingScreen';
import LoginScreen from '@/ui/screens/LoginScreen/LoginScreen';
import SignupScreen, { SignupChooser } from '@/ui/screens/SignupScreen/SignupScreen';
import HomeScreen from '@/ui/screens/HomeScreen/HomeScreen';
import RequestsScreen from '@/ui/screens/RequestsScreen/RequestsScreen';
import NewRequestScreen from '@/ui/screens/RequestsScreen/NewRequestScreen';
import RequestDetailScreen from '@/ui/screens/RequestDetailScreen/RequestDetailScreen';
import DealerListScreen from '@/ui/screens/DealerScreens/DealerListScreen';
import FeedDetailScreen from '@/ui/screens/DealerScreens/FeedDetailScreen';
import QuoteDetailScreen from '@/ui/screens/DealerScreens/QuoteDetailScreen';
import ChatScreen, { ChatRequestsScreen } from '@/ui/screens/ChatScreen/ChatScreen';
import SupportScreens from '@/ui/screens/SupportScreens/SupportScreens';
import AdvisorScreen from '@/ui/screens/AdvisorScreen/AdvisorScreen';
import ProfileScreen from '@/ui/screens/ProfileScreen/ProfileScreen';
import { ForgotPasswordScreen, LegalScreen, NotFoundScreen, UnauthorizedScreen } from '@/ui/screens/UtilityScreens/UtilityScreens';

export const router = createBrowserRouter([
  { path: '/', element: <LandingScreen /> }, { path: '/dealers', element: <DealerLandingScreen /> }, { path: '/login', element: <LoginScreen /> },
  { path: '/signup', element: <SignupChooser /> }, { path: '/signup/:role', element: <SignupScreen /> },
  { path: '/terms', element: <LegalScreen type="terms" /> }, { path: '/privacy', element: <LegalScreen type="privacy" /> },
  { path: '/forgot-password', element: <ForgotPasswordScreen /> },
  { element: <RequireSession><AppShell /></RequireSession>, children: [
    { path: '/home', element: <HomeScreen /> }, { path: '/unauthorized', element: <UnauthorizedScreen /> },
    { path: '/profiles', element: <ProfileScreen /> },
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
    { path: '/support-administration', element: <RequireRole roles={['support-admin','admin']}><SupportScreens /></RequireRole> },
  ]},
  { path: '*', element: <NotFoundScreen /> },
]);
