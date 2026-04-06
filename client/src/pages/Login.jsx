import { useState, useContext, useEffect, useCallback } from 'react';
import { AuthContext } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import api from '../services/api'; // <-- Imported your custom Axios instance

export default function Login() {
    // Form toggle state
    const [isLogin, setIsLogin] = useState(true);
    
    // Form states
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    
    // Server Status States
    const [isServerReady, setIsServerReady] = useState(false);
    const [isWaking, setIsWaking] = useState(true);
    const [serverError, setServerError] = useState(false);
    
    // Submission Lock State
    const [isSubmitting, setIsSubmitting] = useState(false);
    
    const { login, register } = useContext(AuthContext);
    const navigate = useNavigate();

    // --- THE WAKE-UP PING ENGINE ---
    const pingServer = useCallback(async () => {
        setIsWaking(true);
        setServerError(false);
        setIsServerReady(false);
        
        try {
            console.log("Sending wake-up ping to server...");
            // Using your custom API instance
            await api.get('/public/health');
            
            console.log("Server is awake and ready!");
            setIsServerReady(true);
            setServerError(false);
        } catch (error) {
            console.error("Failed to ping server:", error);
            setIsServerReady(false); 
            setServerError(true); 
        } finally {
            setIsWaking(false);
        }
    }, []);

    // Trigger ping on initial load
    useEffect(() => {
        pingServer();
    }, [pingServer]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        // Gatekeeper: Prevent form submission while server is waking or already submitting
        if (isWaking || isSubmitting) return;
        
        // Lock the form
        setIsSubmitting(true);
        
        try {
            if (isLogin) {
                await login(username, password, navigate);
            } else {
                await register(username, email, password, navigate);
                setIsLogin(true); 
                setPassword(''); 
            }
        } finally {
            // Unlock the form whether it succeeds or fails
            setIsSubmitting(false);
        }
    };

    return (
        <div className="flex h-screen items-center justify-center bg-gray-900">
            <div className="w-full max-w-md bg-gray-800 p-8 rounded-lg shadow-lg transition-all duration-300">
                <h2 className={`text-3xl font-bold mb-6 text-center ${isLogin ? 'text-blue-400' : 'text-green-400'}`}>
                    {isLogin ? 'Login' : 'Register'}
                </h2>

                {/* --- SERVER STATUS INDICATORS --- */}
                {/* YELLOW LIGHT: Waking up */}
                {isWaking && (
                    <div className="mb-6 flex items-center justify-center gap-2 text-yellow-500 bg-yellow-500/10 py-2 px-4 rounded-lg border border-yellow-500/20">
                        <span className="relative flex h-3 w-3">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-3 w-3 bg-yellow-500"></span>
                        </span>
                        <span className="text-sm font-semibold animate-pulse">Waking up secure server (~40s)...</span>
                    </div>
                )}

                {/* GREEN LIGHT: Ready */}
                {!isWaking && isServerReady && (
                    <div className="mb-6 flex items-center justify-center gap-2 text-green-400 bg-green-400/10 py-2 px-4 rounded-lg border border-green-400/20">
                        <span className="h-2 w-2 bg-green-400 rounded-full"></span>
                        <span className="text-xs font-semibold uppercase tracking-wider">Server Online</span>
                    </div>
                )}

                {/* RED LIGHT: Error + Retry Trigger */}
                {!isWaking && serverError && (
                    <div className="mb-6 flex flex-col items-center justify-center gap-2 text-red-400 bg-red-400/10 py-3 px-4 rounded-lg border border-red-400/20">
                        <div className="flex items-center gap-2">
                            <span className="h-2 w-2 bg-red-500 rounded-full animate-pulse"></span>
                            <span className="text-xs font-semibold uppercase tracking-wider">Server Offline / Error</span>
                        </div>
                        <button 
                            onClick={pingServer}
                            type="button"
                            className="mt-1 bg-red-500/20 hover:bg-red-500/30 text-red-300 text-xs py-1.5 px-4 rounded transition font-bold"
                        >
                            Retry Connection
                        </button>
                    </div>
                )}
                
                {/* --- LOGIN / REGISTER FORM --- */}
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-gray-300 mb-1">Username</label>
                        <input 
                            type="text" 
                            className={`w-full p-2 bg-gray-700 text-white rounded border border-gray-600 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${isLogin ? 'focus:border-blue-500' : 'focus:border-green-500'}`}
                            value={username} 
                            onChange={(e) => setUsername(e.target.value)} 
                            disabled={isWaking || isSubmitting}
                            required 
                        />
                    </div>

                    {/* Email field ONLY shows when registering */}
                    {!isLogin && (
                        <div className="animate-fade-in">
                            <label className="block text-gray-300 mb-1">Email</label>
                            <input 
                                type="email" 
                                className="w-full p-2 bg-gray-700 text-white rounded border border-gray-600 focus:border-green-500 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                                value={email} 
                                onChange={(e) => setEmail(e.target.value)} 
                                disabled={isWaking || isSubmitting}
                                required={!isLogin} 
                            />
                        </div>
                    )}

                    <div>
                        <label className="block text-gray-300 mb-1">Password</label>
                        <input 
                            type="password" 
                            className={`w-full p-2 bg-gray-700 text-white rounded border border-gray-600 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${isLogin ? 'focus:border-blue-500' : 'focus:border-green-500'}`}
                            value={password} 
                            onChange={(e) => setPassword(e.target.value)} 
                            disabled={isWaking || isSubmitting}
                            required 
                        />
                    </div>

                    <button 
                        type="submit" 
                        disabled={isWaking || isSubmitting || !username || !password || (!isLogin && !email)}
                        className={`w-full font-bold py-2 px-4 rounded transition text-white flex justify-center items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                            isLogin 
                            ? 'bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800' 
                            : 'bg-green-600 hover:bg-green-700 disabled:bg-green-800'
                        }`}
                    >
                        {/* Dynamic Button Text */}
                        {isWaking ? 'Please Wait...' : 
                         isSubmitting ? (
                             <>
                                 <span className="h-4 w-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></span>
                                 Processing...
                             </>
                         ) : 
                         (isLogin ? 'Sign In' : 'Create Account')}
                    </button>
                </form>

                <p className="text-gray-400 mt-4 text-center cursor-pointer">
                    {isLogin ? "Don't have an account? " : "Already have an account? "}
                    <button 
                        type="button"
                        onClick={() => {
                            setIsLogin(!isLogin);
                            setUsername('');
                            setPassword('');
                            setEmail('');
                        }} 
                        className={`hover:underline disabled:opacity-50 disabled:cursor-not-allowed ${isLogin ? 'text-blue-400' : 'text-green-400'}`}
                        disabled={isWaking || isSubmitting}
                    >
                        {isLogin ? 'Register here' : 'Login here'}
                    </button>
                </p>
            </div>
        </div>
    );
}