# ==========================================
# Stage 1: Build the application
# ==========================================
FROM maven:3.9.6-eclipse-temurin-17 AS builder

# Set the working directory inside the container
WORKDIR /app

# Copy the pom.xml and download dependencies first
# (This caches dependencies so future builds are much faster)
COPY pom.xml .
RUN mvn dependency:go-offline -B

# Copy the actual source code
COPY src ./src

# Build the application, skipping tests to speed up deployment
RUN mvn clean package -DskipTests

# ==========================================
# Stage 2: Run the application
# ==========================================
FROM eclipse-temurin:17-jre-jammy

WORKDIR /app

# Copy ONLY the built .jar file from the builder stage
COPY --from=builder /app/target/*.jar app.jar

# Expose the port your app runs on
EXPOSE 8080

# Run the Spring Boot application
ENTRYPOINT ["java", "-jar", "app.jar"]