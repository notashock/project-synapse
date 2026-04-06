package com.college.placementhub.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Deque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedDeque;

@Service
public class DeviceSessionService {
    @Autowired
    private BlacklistService blacklistService;
    private final Map<String, Deque<String>> activeUserTokens = new ConcurrentHashMap<>();
    private final int MAX_DEVICES = 2;

    public void registerNewLogin(String username, String newToken) {
        Deque<String> userTokens = activeUserTokens.computeIfAbsent(username, k -> new ConcurrentLinkedDeque<>());
        if (userTokens.size() >= MAX_DEVICES) {
            String oldestToken = userTokens.pollFirst();
            if (oldestToken != null) {
                blacklistService.addToBlacklist(oldestToken);
                System.out.println("Device limit reached for " + username + ". Old token blacklisted.");
            }
        }
        userTokens.add(newToken);
    }
    public void removeTokenOnLogout(String username, String tokenToremove) {
        Deque<String> userTokens = activeUserTokens.get(username);
        if(userTokens != null){
            userTokens.remove(tokenToremove);
            System.out.println("Token removed from active devices for user: " + username);
        }
    }
}
