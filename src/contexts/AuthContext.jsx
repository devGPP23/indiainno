import { createContext, useContext, useState, useEffect } from "react";
import api from "../utils/api";

const AuthContext = createContext();

export function useAuth() {
    return useContext(AuthContext);
}

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [userProfile, setUserProfile] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchUser = async () => {
            const token = localStorage.getItem('token');
            if (token) {
                try {
                    const res = await api.get('/auth/me');
                    setUser({ uid: res.data._id, phone: res.data.phone, email: res.data.email, role: res.data.role });
                    setUserProfile(res.data);
                } catch (error) {
                    console.error("Token invalid or expired", error);
                    localStorage.removeItem('token');
                    setUser(null);
                    setUserProfile(null);
                }
            }
            setLoading(false);
        };
        fetchUser();
    }, []);

    const login = async (phone, pin) => {
        const { data } = await api.post('/auth/login', { phone, pin });
        localStorage.setItem('token', data.token);
        setUser({ uid: data._id, phone: data.phone, email: data.email, role: data.role });
        setUserProfile(data);
        return data;
    };

    // Args: { name, phone, pin, email?, role, department, city }
    const register = async (formData) => {
        const { data } = await api.post('/auth/register', formData);
        localStorage.setItem('token', data.token);
        setUser({ uid: data._id, phone: data.phone, email: data.email, role: data.role });
        setUserProfile(data);
        return data;
    };

    const logout = () => {
        localStorage.removeItem('token');
        setUser(null);
        setUserProfile(null);
    };

    const value = {
        user,
        userProfile,
        login,
        register,
        logout
    };

    return (
        <AuthContext.Provider value={value}>
            {!loading && children}
        </AuthContext.Provider>
    );
}
