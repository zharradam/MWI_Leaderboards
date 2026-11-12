using Microsoft.AspNetCore.Builder;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using MWI_Leaderboards;
using MWI_Leaderboards.Data;
using MWI_Leaderboards.Services;

var builder = WebApplication.CreateBuilder(args);

/*
builder.Logging.AddSimpleConsole(options =>
{
    options.ColorBehavior = Microsoft.Extensions.Logging.Console.LoggerColorBehavior.Enabled;
    options.SingleLine = true;
});*/
builder.Logging.SetMinimumLevel(LogLevel.Information);
builder.Configuration.AddJsonFile("secrets.json", optional: false, reloadOnChange: false);

builder.Services.AddDbContext<LeaderboardContext>(options =>
	options.UseSqlServer(builder.Configuration["Database:ConnectionString"]));

builder.Services.Configure<Constants>(builder.Configuration.GetSection("Game"));

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
	var db = scope.ServiceProvider.GetRequiredService<LeaderboardContext>();
	await db.Database.EnsureCreatedAsync();
}

app.UseSwagger();
app.UseSwaggerUI();
app.UseDefaultFiles();
app.UseStaticFiles();
app.MapControllers();

var fetchTask = Task.Run(async () =>
{
	var constants = app.Services.GetRequiredService<IOptions<Constants>>().Value;
	var connectionString = builder.Configuration["Database:ConnectionString"]!;
	var logger = app.Services.GetRequiredService<ILogger<LeaderboardService>>();
	var service = new LeaderboardService(constants, connectionString, logger);

	while (true)
	{
		logger.LogInformation($"Starting fetch at {DateTime.UtcNow:O}");
		try { await service.FetchAllAsync(); }
		catch (Exception ex) 
		{ 
			logger.LogInformation($"Run failed: {ex.Message}"); 
		}
		logger.LogInformation($"Next run at {DateTime.UtcNow.AddMinutes(10):HH:mm:ss} UTC");
		await Task.Delay(TimeSpan.FromMinutes(10));
	}
});

await app.RunAsync();