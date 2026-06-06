import { useState, useContext, useEffect, useCallback } from 'react';
import { AuthContext } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import api from '../services/api'; 
import { Zap, Server, ServerCrash, Loader, RefreshCw } from 'lucide-react';

export default function Login() {
    const [isLogin, setIsLogin] = useState(true);
    
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    
    const [isServerReady, setIsServerReady] = useState(false);
    const [isWaking, setIsWaking] = useState(true);
    const [serverError, setServerError] = useState(false);
    
    const [isSubmitting, setIsSubmitting] = useState(false);
    
    const { login, register } = useContext(AuthContext);
    const navigate = useNavigate();

    const pingServer = useCallback(async () => {
        setIsWaking(true);
        setServerError(false);
        setIsServerReady(false);
        
        try {
            console.log("Sending wake-up ping to server...");
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

    useEffect(() => {
        pingServer();
    }, [pingServer]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (isWaking || isSubmitting) return;
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
            setIsSubmitting(false);
        }
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-radial from-gray-800 via-gray-900 to-black p-4 relative overflow-hidden">
            {/* Background blur elements */}
            <div className="absolute top-1/4 left-1/4 w-72 h-72 bg-blue-600/10 rounded-full blur-[100px] pointer-events-none animate-pulse"></div>
            <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-emerald-600/10 rounded-full blur-[120px] pointer-events-none animate-pulse duration-5000"></div>

            <div className="w-full max-w-md bg-white/5 backdrop-blur-xl p-8 rounded-2xl border border-white/10 shadow-[0_12px_40px_0_rgba(0,0,0,0.5)] transition-all duration-300 hover:border-white/15 relative z-10">
                
                {/* Branding/Logo */}
                <div className="text-center mb-6">
                    <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-linear-to-tr from-blue-600 to-indigo-500 shadow-[0_0_20px_rgba(59,130,246,0.3)] mb-3">
                        <Zap className="w-6 h-6 text-white" />
                    </div>
                    <h1 className="text-2xl font-black tracking-tight text-white">
                        Synapse <span className="text-sm font-medium text-gray-400">v1.0</span>
                    </h1>
                    <p className="text-xs text-gray-400 mt-1">Real-time group collaboration & ephemeral streaming</p>
                </div>

                <h2 className={`text-xl font-bold mb-6 text-center tracking-wide ${isLogin ? 'text-blue-400' : 'text-emerald-400'}`}>
                    {isLogin ? 'Welcome Back' : 'Create Account'}
                </h2>

                {/* --- SERVER STATUS INDICATORS --- */}
                {isWaking && (
                    <div className="mb-6 flex items-center justify-center gap-3 text-amber-400 bg-amber-500/10 py-2.5 px-4 rounded-xl border border-amber-500/20">
                        <Loader className="w-4 h-4 animate-spin" />
                        <span className="text-xs font-bold">Waking up secure container... (~40s)</span>
                    </div>
                )}

                {!isWaking && isServerReady && (
                    <div className="mb-6 flex items-center justify-center gap-2 text-emerald-400 bg-emerald-500/10 py-2 px-4 rounded-xl border border-emerald-500/20">
                        <Server className="w-3.5 h-3.5" />
                        <span className="text-[10px] font-black uppercase tracking-widest">Secure Server Online</span>
                    </div>
                )}

                {!isWaking && serverError && (
                    <div className="mb-6 flex flex-col items-center justify-center gap-2 text-red-400 bg-red-500/10 py-3 px-4 rounded-xl border border-red-500/20">
                        <div className="flex items-center gap-2">
                            <ServerCrash className="w-4 h-4" />
                            <span className="text-[10px] font-black uppercase tracking-widest">Connection Failed</span>
                        </div>
                        <button 
                            onClick={pingServer}
                            type="button"
                            className="mt-1 bg-red-500/25 hover:bg-red-500/35 text-red-300 text-xs py-1.5 px-4 rounded-lg transition font-bold border border-red-500/30 active:scale-95 flex items-center gap-1.5"
                        >
                            <RefreshCw className="w-3 h-3" />
                            Retry Connection
                        </button>
                    </div>
                )}
                
                {/* --- LOGIN / REGISTER FORM --- */}
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">Username</label>
                        <input 
                            type="text" 
                            className={`w-full px-4 py-3 bg-gray-900/60 text-white rounded-xl border border-gray-700/50 focus:outline-none focus:ring-2 focus:ring-opacity-40 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${
                                isLogin 
                                ? 'focus:border-blue-500 focus:ring-blue-500 focus:shadow-[0_0_15px_rgba(59,130,246,0.15)]' 
                                : 'focus:border-emerald-500 focus:ring-emerald-500 focus:shadow-[0_0_15px_rgba(16,185,129,0.15)]'
                            }`}
                            value={username} 
                            onChange={(e) => setUsername(e.target.value)} 
                            disabled={isWaking || isSubmitting}
                            required 
                            placeholder="username"
                        />
                    </div>

                    {!isLogin && (
                        <div className="animate-fade-in">
                            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">Email</label>
                            <input 
                                type="email" 
                                className="w-full px-4 py-3 bg-gray-900/60 text-white rounded-xl border border-gray-700/50 focus:border-emerald-500 focus:ring-emerald-500 focus:ring-2 focus:ring-opacity-40 focus:outline-none focus:shadow-[0_0_15px_rgba(16,185,129,0.15)] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                                value={email} 
                                onChange={(e) => setEmail(e.target.value)} 
                                disabled={isWaking || isSubmitting}
                                required={!isLogin} 
                                placeholder="name@domain.com"
                            />
                        </div>
                    )}

                    <div>
                        <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">Password</label>
                        <input 
                            type="password" 
                            className={`w-full px-4 py-3 bg-gray-900/60 text-white rounded-xl border border-gray-700/50 focus:outline-none focus:ring-2 focus:ring-opacity-40 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${
                                isLogin 
                                ? 'focus:border-blue-500 focus:ring-blue-500 focus:shadow-[0_0_15px_rgba(59,130,246,0.15)]' 
                                : 'focus:border-emerald-500 focus:ring-emerald-500 focus:shadow-[0_0_15px_rgba(16,185,129,0.15)]'
                            }`}
                            value={password} 
                            onChange={(e) => setPassword(e.target.value)} 
                            disabled={isWaking || isSubmitting}
                            required 
                            placeholder="••••••••"
                        />
                    </div>

                    <button 
                        type="submit" 
                        disabled={isWaking || isSubmitting || !username || !password || (!isLogin && !email)}
                        className={`w-full font-bold py-3 px-4 rounded-xl transition-all duration-200 text-white flex justify-center items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] ${
                            isLogin 
                            ? 'bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 shadow-[0_4px_12px_rgba(59,130,246,0.2)]' 
                            : 'bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-800 shadow-[0_4px_12px_rgba(16,185,129,0.2)]'
                        }`}
                    >
                        {isWaking ? 'Verifying Host...' : 
                         isSubmitting ? (
                             <>
                                 <Loader className="w-4 h-4 animate-spin" />
                                 Processing...
                             </>
                         ) : 
                         (isLogin ? 'Sign In' : 'Create Account')}
                    </button>
                </form>

                <p className="text-gray-400 mt-6 text-center text-sm">
                    {isLogin ? "Don't have an account? " : "Already have an account? "}
                    <button 
                        type="button"
                        onClick={() => {
                            setIsLogin(!isLogin);
                            setUsername('');
                            setPassword('');
                            setEmail('');
                        }} 
                        className={`hover:underline font-bold focus:outline-none transition ${isLogin ? 'text-blue-400 hover:text-blue-300' : 'text-emerald-400 hover:text-emerald-300'}`}
                        disabled={isWaking || isSubmitting}
                    >
                        {isLogin ? 'Register here' : 'Login here'}
                    </button>
                </p>
            </div>
        </div>
    );
}