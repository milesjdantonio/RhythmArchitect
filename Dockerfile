# The Spring Boot backend (backend/), with the game's classes it builds in (src/java/main:
# Song, Note, Queue...). Built from the repo root so both folders are in the context.
#   docker build -t rythm-backend .
#   docker run -p 8080:8080 -e YOUTUBE_API_KEY=... rythm-backend

FROM eclipse-temurin:25-jdk AS build
WORKDIR /src
COPY backend/.mvn backend/.mvn
COPY backend/mvnw backend/pom.xml backend/
# Dependencies first, so code changes don't download them again.
RUN cd backend && sh ./mvnw -B -q dependency:go-offline
COPY backend/src backend/src
COPY src/java src/java
RUN cd backend && sh ./mvnw -B -q -DskipTests package && cp target/backend-*.jar /src/app.jar

FROM eclipse-temurin:25-jre
WORKDIR /app
COPY --from=build /src/app.jar app.jar
# Render (and most hosts) set PORT; the app listens on it (8080 if unset).
ENV PORT=8080
EXPOSE 8080
CMD ["java", "-XX:MaxRAMPercentage=75", "-jar", "app.jar"]
