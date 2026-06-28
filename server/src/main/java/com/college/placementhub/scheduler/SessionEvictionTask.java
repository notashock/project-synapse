package com.college.placementhub.scheduler;

import com.college.placementhub.model.Session;
import com.college.placementhub.model.SessionStatus;
import com.college.placementhub.repository.SessionRepository;
import com.college.placementhub.service.SessionService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.Map;

@Slf4j
@Component
@RequiredArgsConstructor
public class SessionEvictionTask {

    private final SessionService sessionService;
    private final SessionRepository sessionRepository;

    @Scheduled(fixedRate = 300000) // Runs every 5 minutes
    public void evictInactiveSessions() {
        log.info("Running session eviction sweeper...");
        long now = System.currentTimeMillis();
        long evictionThreshold = 300000; // 5 minutes

        Map<String, Long> emptySessionTimestamps = sessionService.getEmptySessionTimestamps();
        Map<String, Map<String, String>> sessionUserSockets = sessionService.getSessionUserSockets();

        for (Map.Entry<String, Long> entry : emptySessionTimestamps.entrySet()) {
            String sessionId = entry.getKey();
            Long emptySince = entry.getValue();

            if (now - emptySince > evictionThreshold) {
                // Ensure there are indeed 0 active sockets mapped
                Map<String, String> sockets = sessionUserSockets.get(sessionId);
                if (sockets == null || sockets.isEmpty()) {
                    Session session = sessionRepository.findById(sessionId).orElse(null);
                    if (session != null && session.getStatus() == SessionStatus.ACTIVE) {
                        session.setStatus(SessionStatus.INACTIVE);
                        sessionRepository.save(session);
                        log.info("Evicted session {} due to inactivity", sessionId);
                    }
                    emptySessionTimestamps.remove(sessionId);
                }
            }
        }
    }
}
