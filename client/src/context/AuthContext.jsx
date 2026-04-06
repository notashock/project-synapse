// src/context/AuthContext.jsx
import { createContext, useState, useEffect } from 'react';
import api from '../services/api';
import toast from 'react-hot-toast';

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const storedUser = localStorage.getItem('user');
        const token = localStorage.getItem('token');
        if (storedUser && token) {
            setUser(JSON.parse(storedUser));
        }
        setLoading(false);
    }, []);

    const login = async (username, password, navigate) => {
        try {
            const response = await api.post('/auth/login', { username, password });
            const { token, id, email, roles } = response.data;
            
            const userData = { id, username: response.data.username, email, roles };
            
            localStorage.setItem('token', token);
            localStorage.setItem('user', JSON.stringify(userData));
            setUser(userData);
            
            toast.success('Login successful!');
            navigate('/dashboard'); 
        } catch (error) {
            toast.error(error.response?.data?.message || 'Login failed');
        }
    };

    const register = async (username, email, password, navigate) => {
        try {
            await api.post('/auth/register', { username, email, password });
            toast.success('Registration successful! Please login.');
        } catch (error) {
            toast.error(error.response?.data?.message || 'Registration failed');
        }
    };

    // UPDATED LOGOUT FUNCTION
    const logout = async (navigate) => {
        try {
            // Tell the backend to blacklist this token
            await api.post('/auth/logout');
        } catch (error) {
            console.error("Backend logout failed, proceeding with local logout.");
        } finally {
            // Wipe local storage regardless of backend response
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            setUser(null);
            toast.success('Logged out successfully');
            
            // Navigate back to login screen
            if (navigate) {
                navigate('/login');
            }
        }
    };

    return (
        <AuthContext.Provider value={{ user, login, register, logout, loading }}>
            {children}
        </AuthContext.Provider>
    );
};