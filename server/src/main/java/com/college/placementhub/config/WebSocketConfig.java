package com.college.placementhub.config;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketTransportRegistration;

@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {
    @Value("${app.frontend.url}")
    private String frontendUrl;
    @Autowired
    private SenderBypassInterceptor senderBypassInterceptor;
    @Override
    public void configureMessageBroker(MessageBrokerRegistry config){
        config.enableSimpleBroker("/topic");
        config.setApplicationDestinationPrefixes("/app");
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry){
        registry.addEndpoint("/ws-placement").setAllowedOriginPatterns("*").withSockJS();
    }
    @Override
    public void configureWebSocketTransport(WebSocketTransportRegistration registration){
        registration.setMessageSizeLimit(50 * 1024 * 1024);
        registration.setSendBufferSizeLimit(50 * 1024 * 1024);
        registration.setSendTimeLimit(20000);
    }
    @Override
    public void configureClientOutboundChannel(ChannelRegistration registration){
        registration.interceptors(senderBypassInterceptor);
    }
}
