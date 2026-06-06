/* eslint-disable react-refresh/only-export-components */
import { createContext, useState, useContext } from 'react';

const SessionNavContext = createContext();

export const useSessionNav = () => useContext(SessionNavContext);

export const SessionNavProvider = ({ children }) => {
    const [sessionNav, setSessionNav] = useState(null);

    return (
        <SessionNavContext.Provider value={{ sessionNav, setSessionNav }}>
            {children}
        </SessionNavContext.Provider>
    );
};
