package com.college.placementhub.service;

import org.springframework.stereotype.Service;

import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class BlacklistService {
    private final Set<String> blacklistedTokens = ConcurrentHashMap.newKeySet();

    public void addToBlacklist(String token){
        blacklistedTokens.add(token);
        System.out.println("Token added to blacklist: " + token);
    }
    public boolean isBlacklisted(String token){
        return blacklistedTokens.contains(token);
    }
}
