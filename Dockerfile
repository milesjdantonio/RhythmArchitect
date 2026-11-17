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
# Starting fast (a sleeping free server wakes on the first visit): the jar unpacked (classes load
# quicker than from a jar inside a jar), then one training start (it stops as soon as the app is
# ready) leaves an ahead-of-time cache of the classes it loaded and linked (Java 25, JEP 483/514).
# Measured: about 4.6 s to start before, about 2.1 s with both.
RUN java -Djarmode=tools -jar app.jar extract --destination /app/run && rm app.jar
WORKDIR /app/run
RUN SONGS_FILE=/tmp/training/songs.json java -XX:MaxRAMPercentage=75 -XX:AOTCacheOutput=app.aot       -Dspring.context.exit=onRefresh -jar app.jar && rm -rf /tmp/training
# Render (and most hosts) set PORT; the app listens on it (8080 if unset).
ENV PORT=8080
EXPOSE 8080
# The same memory flag as the training start (the cache is only used with a matching setup).
CMD ["java", "-XX:MaxRAMPercentage=75", "-XX:AOTCache=app.aot", "-jar", "app.jar"]
